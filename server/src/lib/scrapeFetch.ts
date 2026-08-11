// FETCHING FROM SOMEWHERE THAT DOES NOT WANT TO HEAR FROM A DATACENTRE.
//
// OLX sits behind CloudFront's WAF, and CloudFront blocks the address,
// not the request. Confirmed the hard way: identical requests from a
// home connection return the page and from Fly return a 919-byte
// "Request blocked" stub, and a full browser header set — sec-fetch-*,
// sec-ch-ua, accept, upgrade-insecure-requests — changes nothing. There
// is no user-agent clever enough to fix a rejected IP.
//
// The official route was checked first and is a dead end: OLX does have
// a Partner API, but every advert endpoint on it is scoped to the
// authenticated partner's OWN listings (`GET /adverts` is "Get user
// adverts"). It is for managing your own inventory. It cannot see other
// people's lost-pet ads, which is the entire thing we need.
//
// So the remaining honest option is to make the request from an address
// that is not a datacentre. This module is the seam for that: set
// SCRAPE_PROXY_URL and outbound scrape traffic goes through it; leave it
// unset and behaviour is exactly what it is today. No provider is
// hardcoded — any HTTP(S) proxy URL works, so switching vendors is an
// env var, not a deploy of new code.
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
  const maxAttempts = proxy && opts.retryOnBlock !== false ? 3 : 1;

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
      // Blocked and we have a retry left: the next attempt gets a new
      // exit address from the pool.
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
