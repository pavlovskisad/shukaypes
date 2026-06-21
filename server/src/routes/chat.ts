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

type Lang = 'uk' | 'en';

function normaliseLang(raw: unknown): Lang {
  return raw === 'en' ? 'en' : 'uk';
}

// Tail system block — per-request, never cached. Tells the model
// which language to default to. CORE_SYSTEM's VOICE rule references
// this block by name so the priority is unambiguous (LANG wins over
// inferred-from-input on the first turn; user can still flip by
// writing back in another language).
function langBlock(lang: Lang): string {
  return lang === 'uk'
    ? 'LANG: uk\nThe human prefers ukrainian. default to ukrainian on every reply. switch only if they write back clearly in another language.'
    : 'LANG: en\nThe human prefers english. default to english on every reply. switch only if they write back clearly in another language.';
}

async function assembleSystem(
  userId: string,
  pos: Pos,
  lang: Lang,
  spots?: NearbySpot[],
  viewport?: Pos | null,
): Promise<Anthropic.TextBlockParam[]> {
  // Render order is tools → system → messages. Keep stable blocks first
  // so cache_control breakpoints survive volatile memory/context edits below.
  const [memory, context] = await Promise.all([
    loadMemoryBlock(userId),
    buildContextBlock({
      userId,
      pos: pos.lat != null && pos.lng != null ? { lat: pos.lat, lng: pos.lng } : null,
      spots,
      viewport:
        viewport && viewport.lat != null && viewport.lng != null
          ? { lat: viewport.lat, lng: viewport.lng }
          : null,
    }),
  ]);
  return [
    { type: 'text', text: CORE_SYSTEM, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: ACTIONS_SYSTEM, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: memory },
    { type: 'text', text: context },
    // LANG tail block — uncached on purpose. Two short strings, no
    // cache value, and per-user state.
    { type: 'text', text: langBlock(lang) },
  ];
}

const GREET_PROMPT: Record<Lang, string> = {
  uk: '*user just opened chat and has not said anything yet. greet them warmly in ukrainian — short, dog-voice, sensory, one sentence. no stacked questions. no offer of help. just hello-in-dog. examples: "*хвостом* нарешті — пахне дощем, ходімо?", "*ніс угору* — ти. ходімо нюхати київ", "*вухом* привіт. куди сьогодні?". do not greet in english.*',
  en: '*user just opened chat and has not said anything yet. greet them warmly in english — short, dog-voice, sensory, one sentence. no stacked questions. no offer of help. just hello-in-dog. examples: "*tail wag* finally. let\'s go before that pigeon gets ideas.", "*nose up* — you. ready to walk?".*',
};

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
      // Where the user is LOOKING on the map (viewport centre).
      // Optional. When present, the dog leans on this for lore /
      // lost-pet proximity so he comments on the area being browsed,
      // not just the GPS spot the human is standing on.
      vLat?: number;
      vLng?: number;
      greet?: boolean;
      // Closest few spots from the client's gameStore. Used to populate
      // the CONTEXT block so the companion can emit walk_to_spot for
      // spots the human names. Optional — chat still works without it,
      // just without the spot-routing capability.
      spots?: NearbySpot[];
      // App-side language preference (set in profile language toggle,
      // persisted in localStorage). Defaults to UK when omitted.
      lang?: Lang;
    };
  }>(
    '/chat',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = req.body ?? ({} as any);
      const greet = body.greet === true;
      const lang = normaliseLang(body.lang);
      const rawText = typeof body.text === 'string' ? body.text.slice(0, MAX_INPUT_CHARS).trim() : '';
      if (!greet && !rawText) {
        reply.code(400);
        return { error: 'text required' };
      }

      const userText = greet ? GREET_PROMPT[lang] : rawText;
      const pos: Pos = { lat: body.lat, lng: body.lng };
      const viewport: Pos | null =
        body.vLat != null && body.vLng != null
          ? { lat: body.vLat, lng: body.vLng }
          : null;

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
        assembleSystem(req.userId, pos, lang, spots, viewport),
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
          .trim() || (lang === 'uk' ? 'гав...' : 'woof...');
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
        return {
          error:
            lang === 'uk'
              ? 'я нюхаю, спробуй за секунду'
              : 'companion is sniffing, try again in a sec',
        };
      }
    },
  );

  app.post<{ Body: { lat?: number; lng?: number; lang?: Lang } }>(
    '/chat/ambient',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = req.body ?? {};
      const lang = normaliseLang(body.lang);
      const pos: Pos = { lat: body.lat, lng: body.lng };
      const system = await assembleSystem(req.userId, pos, lang);

      try {
        const stream = anthropic().messages.stream({
          model: AMBIENT_MODEL,
          max_tokens: 60,
          system,
          messages: [
            {
              role: 'user',
              content:
                '*ambient beat — you see or smell something on the walk right now. say one short thing to the human. max 6 words, lowercase, like a bubble on the map. honour the LANG tail block.*',
            },
          ],
          // Same belt-and-braces fake-turn guard as the active chat.
          stop_sequences: ['\nUser:', '\nuser:', '\nHuman:', '\nhuman:'],
        });
        const final = await stream.finalMessage();
        const text = (final.content.filter((b) => b.type === 'text') as Anthropic.TextBlock[])
          .map((b) => b.text)
          .join(' ')
          .trim() || (lang === 'uk' ? '*нюх-нюх*' : '*sniff sniff*');
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
