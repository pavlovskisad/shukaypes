import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type Anthropic from '@anthropic-ai/sdk';
import { db, schema } from '../db/index.js';
import { anthropic, ACTIVE_MODEL, AMBIENT_MODEL } from '../services/anthropic.js';
import { CORE_SYSTEM } from '../prompts/core.js';
import { ACTIONS_SYSTEM } from '../prompts/actions.js';
import { loadMemoryBlock } from '../prompts/memory.js';
import { buildContextBlock, type NearbySpot } from '../prompts/context.js';
import { parseActionTag, type CompanionAction } from '../services/actionParser.js';
import { scheduleMemoryUpdate } from '../services/memorySummary.js';

const HISTORY_LIMIT = 10;
const MAX_INPUT_CHARS = 2000;

interface Pos { lat?: number; lng?: number }

async function assembleSystem(
  userId: string,
  pos: Pos,
  spots?: NearbySpot[],
): Promise<Anthropic.TextBlockParam[]> {
  // Render order is tools → system → messages. Keep stable blocks first
  // so cache_control breakpoints survive volatile memory/context edits below.
  const [memory, context] = await Promise.all([
    loadMemoryBlock(userId),
    buildContextBlock({
      userId,
      pos: pos.lat != null && pos.lng != null ? { lat: pos.lat, lng: pos.lng } : null,
      spots,
    }),
  ]);
  return [
    { type: 'text', text: CORE_SYSTEM, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: ACTIONS_SYSTEM, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: memory },
    { type: 'text', text: context },
  ];
}

async function recentHistory(userId: string): Promise<Anthropic.MessageParam[]> {
  const rows = await db
    .select({ role: schema.messages.role, content: schema.messages.content })
    .from(schema.messages)
    .where(eq(schema.messages.userId, userId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(HISTORY_LIMIT);
  return rows
    .reverse()
    .map((r) => ({ role: r.role === 'assistant' ? 'assistant' : 'user', content: r.content }));
}

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/chat/history', async (req) => {
    const rows = await db
      .select({
        id: schema.messages.id,
        role: schema.messages.role,
        content: schema.messages.content,
        mode: schema.messages.mode,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(
        and(eq(schema.messages.userId, req.userId), eq(schema.messages.mode, 'active')),
      )
      .orderBy(asc(schema.messages.createdAt))
      .limit(100);
    return {
      messages: rows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        mode: r.mode,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  app.post<{
    Body: {
      text: string;
      lat?: number;
      lng?: number;
      greet?: boolean;
      // Closest few spots from the client's gameStore. Used to populate
      // the CONTEXT block so the companion can emit walk_to_spot for
      // spots the human names. Optional — chat still works without it,
      // just without the spot-routing capability.
      spots?: NearbySpot[];
    };
  }>(
    '/chat',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = req.body ?? ({} as any);
      const greet = body.greet === true;
      const rawText = typeof body.text === 'string' ? body.text.slice(0, MAX_INPUT_CHARS).trim() : '';
      if (!greet && !rawText) {
        reply.code(400);
        return { error: 'text required' };
      }

      const userText = greet
        ? '*user just opened chat and has not said anything yet. you have no language signal from them. greet warmly in english with one short ukrainian phrase alongside (e.g. "hi / привіт") so they can pick the language with their reply. one short sentence, dog voice, no stacked questions.*'
        : rawText;
      const pos: Pos = { lat: body.lat, lng: body.lng };

      // Persist user message first so it's in history even if Claude fails.
      const userMsgId = nanoid();
      if (!greet) {
        await db.insert(schema.messages).values({
          id: userMsgId,
          userId: req.userId,
          role: 'user',
          content: rawText,
          mode: 'active',
        });
      }

      const spots = Array.isArray(body.spots) ? (body.spots as NearbySpot[]) : undefined;
      const [system, history] = await Promise.all([
        assembleSystem(req.userId, pos, spots),
        recentHistory(req.userId),
      ]);
      const last = history[history.length - 1];
      const messages: Anthropic.MessageParam[] = greet
        ? [{ role: 'user', content: userText }]
        : last && last.role === 'user'
          ? history
          : [...history, { role: 'user', content: userText }];

      try {
        const stream = anthropic().messages.stream({
          model: ACTIVE_MODEL,
          max_tokens: 400,
          system,
          messages,
          // Hard guarantee against the model fabricating a fake user
          // turn at the tail of its own reply (seen in PWA sessions
          // where the stored memory note had transcript-style "user:"
          // / "assistant:" prefixes that primed continuation). Stops
          // generation the moment the model tries to emit one.
          stop_sequences: ['\nUser:', '\nuser:', '\nHuman:', '\nhuman:'],
        });
        const final = await stream.finalMessage();
        const text = (final.content.filter((b) => b.type === 'text') as Anthropic.TextBlock[])
          .map((b) => b.text)
          .join(' ')
          .trim() || 'woof...';
        const { visible, action } = parseActionTag(text);
        const usage = final.usage;

        const assistantId = nanoid();
        await db.insert(schema.messages).values({
          id: assistantId,
          userId: req.userId,
          role: 'assistant',
          content: visible,
          mode: 'active',
          model: ACTIVE_MODEL,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        });

        // Fire-and-forget memory summarisation — only actually calls
        // the model every Nth turn, see services/memorySummary.ts.
        scheduleMemoryUpdate(req.userId);

        req.log.info(
          {
            kind: 'chat_cost',
            userId: req.userId,
            model: ACTIVE_MODEL,
            in: usage.input_tokens,
            out: usage.output_tokens,
            cacheRead: usage.cache_read_input_tokens ?? 0,
            cacheWrite: usage.cache_creation_input_tokens ?? 0,
            action: action?.name ?? 'none',
          },
          'chat active turn',
        );

        return {
          id: assistantId,
          text: visible,
          action: action satisfies CompanionAction | null,
        };
      } catch (err) {
        req.log.error({ err }, 'chat active failed');
        reply.code(502);
        return { error: 'companion is sniffing, try again in a sec' };
      }
    },
  );

  app.post<{ Body: { lat?: number; lng?: number } }>(
    '/chat/ambient',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = req.body ?? {};
      const pos: Pos = { lat: body.lat, lng: body.lng };
      const system = await assembleSystem(req.userId, pos);

      try {
        const stream = anthropic().messages.stream({
          model: AMBIENT_MODEL,
          max_tokens: 60,
          system,
          messages: [
            {
              role: 'user',
              content:
                '*ambient beat — you see or smell something on the walk right now. say one short thing to the human. max 6 words, lowercase, like a bubble on the map.*',
            },
          ],
          // Same belt-and-braces fake-turn guard as the active chat.
          stop_sequences: ['\nUser:', '\nuser:', '\nHuman:', '\nhuman:'],
        });
        const final = await stream.finalMessage();
        const text = (final.content.filter((b) => b.type === 'text') as Anthropic.TextBlock[])
          .map((b) => b.text)
          .join(' ')
          .trim() || '*sniff sniff*';
        // Ambient bubbles are short — strip any stray action tag the
        // model might have appended; we don't dispatch from ambient.
        const { visible } = parseActionTag(text);
        const usage = final.usage;

        await db.insert(schema.messages).values({
          id: nanoid(),
          userId: req.userId,
          role: 'assistant',
          content: visible,
          mode: 'ambient',
          model: AMBIENT_MODEL,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        });

        req.log.info(
          {
            kind: 'chat_cost',
            userId: req.userId,
            model: AMBIENT_MODEL,
            in: usage.input_tokens,
            out: usage.output_tokens,
            cacheRead: usage.cache_read_input_tokens ?? 0,
            cacheWrite: usage.cache_creation_input_tokens ?? 0,
          },
          'chat ambient',
        );

        return { text: visible };
      } catch (err) {
        req.log.error({ err }, 'chat ambient failed');
        reply.code(502);
        return { error: 'ambient skipped' };
      }
    },
  );
};

export default plugin;
