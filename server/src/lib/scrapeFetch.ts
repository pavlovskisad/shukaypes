// FETCHING FROM SOMEWHERE THAT ONLY SOMETIMES WANTS TO HEAR FROM US.
//
// CORRECTED 17 Aug. This file used to open by asserting that "CloudFront
// blocks the address, not the request", and that conclusion is wrong in
// the way that mattered most: it is not a block at all, it is a COIN
// FLIP, and believing it was a block is what disabled the retry below.
//
// What was actually measured, from the Fly machine, no proxy, the same
// URL eight times in a row:
//
//     403 200 403 200 403 200 403 200
//
// Fifty per cent, alternating, deterministic. An 8-second gap between
// requests did not change it, so it is not time-based throttling. The
// same URL from a different datacentre returned 200 five times out of
// five, so it is not a universal ban on datacentres either.
//
// Also measured, and worth keeping because it cost a proxy subscription
// to learn: routing through four Ukrainian RESIDENTIAL addresses — two
// in Kyiv — with a full browser header set returned 403/919 every single
// time. A residential exit is not the fix. The retry is.
//
// The original observation behind the old comment (home connection works,
// Fly does not) was real but confounded: it compared a home browser with
// a datacentre Node client and attributed the difference to the address.
//
// The official route was checked first and is a dead end: OLX does have
// a Partner API, but every advert endpoint on it is scoped to the
// authenticated partner's OWN listings (`GET /adverts` is "Get user
// adverts"). It is for managing your own inventory. It cannot see other
// people's lost-pet ads, which is the entire thing we need.
//
// SCRAPE_PROXY_URL remains as a seam, and is still the right tool if the
// edge ever hardens into a real block: set it and outbound scrape traffic
// goes through it, leave it unset and nothing changes. No provider is
// hardcoded, so switching vendors is an env var rather than a deploy.
// On the evidence above it is not needed today, and it is NOT set.
//
// Note the seam is deliberately narrow: it wraps SCRAPING only. The rest
// of the server's outbound traffic (Anthropic, Google, Telegram) keeps
// going direct, because routing an API key through a third-party proxy
// to solve a problem those hosts don't have would be a bad trade.

import { ProxyAgent } from 'undici';

// One agent for the process, not one per request: each ProxyAgent owns a
// connection pool, and building a fresh one per fetch would open a new
// pool per listing page.
let agent: ProxyAgent | null = null;
let agentFor: string | null = null;

function dispatcherFor(proxyUrl: string): ProxyAgent {
  if (!agent || agentFor !== proxyUrl) {
    agent = new ProxyAgent(proxyUrl);
    agentFor = proxyUrl;
  }
  return agent;
}

export function scrapeProxyUrl(): string | undefined {
  const raw = process.env.SCRAPE_PROXY_URL?.trim();
  return raw ? raw : undefined;
}

// Host only — a proxy URL carries credentials and must never reach a log
// line intact.
export function scrapeProxyDescription(): string {
  const raw = scrapeProxyUrl();
  if (!raw) return 'direct (no SCRAPE_PROXY_URL set)';
  try {
    const u = new URL(raw);
    return `proxy ${u.protocol}//${u.host}`;
  } catch {
    return 'proxy (unparseable SCRAPE_PROXY_URL)';
  }
}

export interface ScrapeFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  // Rotating residential proxies hand out a different exit address per
  // connection, so a refusal is worth one more try on a new one. Pure
  // waste without a proxy — the address is the same every time and so is
  // the answer — hence the retry only applies when proxying.
  retryOnBlock?: boolean;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 500;
const BLOCKED_STATUSES = new Set([403, 429]);

export interface ScrapeResponse {
  ok: boolean;
  status: number;
  body: string;
  // How many attempts it took. >1 means a retry rescued it, which is the
  // signal that rotation is doing real work.
  attempts: number;
}

export async function scrapeFetch(
  url: string,
  opts: ScrapeFetchOptions = {},
): Promise<ScrapeResponse> {
  const proxy = scrapeProxyUrl();
  // RETRY WITH OR WITHOUT A PROXY.
  //
  // This used to be `proxy && …`, on the reasoning that retrying a fixed
  // address is pure waste because "the answer is the same every time".
  // Measured on 17 Aug, from the Fly machine, no proxy: the same URL
  // fetched eight times in a row returned
  //
  //     403 200 403 200 403 200 403 200
  //
  // Fifty per cent, alternating, deterministic — and an 8s gap between
  // requests did not change it, so it is not time-based throttling
  // either. Whatever the edge is doing, a second attempt rescues almost
  // all of it. Leaving the retry proxy-only meant HALF of every scrape
  // tick was thrown away, which is what "OLX is half-blocked" has been
  // describing all along.
  const maxAttempts = opts.retryOnBlock !== false ? 3 : 1;

  let last: ScrapeResponse = { ok: false, status: 0, body: '', attempts: 0 };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: opts.headers,
        redirect: 'follow',
        signal: ctl.signal,
        // `dispatcher` is undici's, not part of the DOM RequestInit that
        // TypeScript types global fetch with — hence the cast. Node's
        // fetch IS undici, so it is honoured at runtime.
        ...(proxy ? ({ dispatcher: dispatcherFor(proxy) } as unknown as object) : {}),
      });
      const body = await res.text();
      last = { ok: res.ok, status: res.status, body, attempts: attempt };
      if (res.ok || !BLOCKED_STATUSES.has(res.status)) return last;
      // Blocked with a retry left. With a proxy the next attempt gets a
      // new exit address; without one it simply gets the other side of
      // the alternation. Both are worth taking.
      //
      // A short pause rather than an instant retry: the measurement says
      // an immediate one works, but there is no hurry inside an hourly
      // cron and a refused request is not something to hammer.
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    } catch (err) {
      last = {
        ok: false,
        status: 0,
        body: (err as Error).message,
        attempts: attempt,
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}
