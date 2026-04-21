import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type Anthropic from '@anthropic-ai/sdk';
import { db, schema } from '../db/index.js';
import { anthropic, ACTIVE_MODEL, AMBIENT_MODEL } from '../services/anthropic.js';
import { CORE_SYSTEM } from '../prompts/core.js';
import { ACTIONS_SYSTEM } from '../prompts/actions.js';
import { loadMemoryBlock } from '../prompts/memory.js';
import { buildContextBlock } from '../prompts/context.js';

const HISTORY_LIMIT = 10;
const MAX_INPUT_CHARS = 2000;

interface Pos { lat?: number; lng?: number }

function sanitizeText(raw: string): { visible: string; rawAction: string | null } {
  // Strip the machine-only <<act:...>> suffix from user-visible text.
  const m = raw.match(/<<act:[^:]+:[\s\S]*?>>\s*$/);
  if (!m) return { visible: raw.trim(), rawAction: null };
  return {
    visible: raw.slice(0, m.index).trim(),
    rawAction: m[0],
  };
}

async function assembleSystem(userId: string, pos: Pos): Promise<Anthropic.TextBlockParam[]> {
  // Render order is tools → system → messages. Keep stable blocks first
  // so cache_control breakpoints survive volatile memory/context edits below.
  const [memory, context] = await Promise.all([
    loadMemoryBlock(userId),
    buildContextBlock({
      userId,
      pos: pos.lat != null && pos.lng != null ? { lat: pos.lat, lng: pos.lng } : null,
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

  app.post<{ Body: { text: string; lat?: number; lng?: number; greet?: boolean } }>(
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

      const [system, history] = await Promise.all([
        assembleSystem(req.userId, pos),
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
        });
        const final = await stream.finalMessage();
        const text = (final.content.filter((b) => b.type === 'text') as Anthropic.TextBlock[])
          .map((b) => b.text)
          .join(' ')
          .trim() || 'woof...';
        const { visible, rawAction } = sanitizeText(text);
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

        req.log.info(
          {
            kind: 'chat_cost',
            userId: req.userId,
            model: ACTIVE_MODEL,
            in: usage.input_tokens,
            out: usage.output_tokens,
            cacheRead: usage.cache_read_input_tokens ?? 0,
            cacheWrite: usage.cache_creation_input_tokens ?? 0,
            action: rawAction ? 'present' : 'none',
          },
          'chat active turn',
        );

        return { id: assistantId, text: visible, action: rawAction };
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
        });
        const final = await stream.finalMessage();
        const text = (final.content.filter((b) => b.type === 'text') as Anthropic.TextBlock[])
          .map((b) => b.text)
          .join(' ')
          .trim() || '*sniff sniff*';
        const { visible } = sanitizeText(text);
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
