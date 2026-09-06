// The public Wikimedia endpoints the lore corpus is researched from.
//
// Shared by seed-lore.ts (first write of a row) and enrich-lore.ts (the
// Wikipedia handle and the longer telling, later). All anonymous, all
// read-only, all rate-limited by the caller's sleep between rows rather
// than here. Every function answers null on any failure — a landmark
// with no research gets a thinner line, never an aborted run.
//
// Wikidata (CC0) and Wikipedia (CC-BY-SA) text is research input; the
// prose that ships is the dog's, written by the model from these facts.
// The one place Wikipedia text is shown as-is is the client's "read
// more", which links back to the article for exactly that reason.

import type { GeoCandidate } from './loreMatch.js';

const UA = 'shukajpes-lore-seed/1.0 (contact: pavlovskisad@gmail.com)';

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// Wikidata's short description ("пам'ятник у Києві"), uk first.
export async function fetchWikidataDesc(qid: string): Promise<string | null> {
  const json = await getJson<{
    entities?: Record<string, { descriptions?: Record<string, { value: string }> }>;
  }>(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
  const ent = json?.entities?.[qid];
  if (!ent) return null;
  return (
    ent.descriptions?.uk?.value ??
    ent.descriptions?.en?.value ??
    ent.descriptions?.ru?.value ??
    null
  );
}

export interface WikidataLinks {
  qid: string;
  description: string | null;
  // Article titles on each project, when the entity has one.
  ukwiki: string | null;
  enwiki: string | null;
}

// Sitelinks for a batch of entities. The seed only ever read the OSM
// `wikipedia=` tag; most objects carry a `wikidata=` tag instead, and the
// entity behind it knows its own articles. Fifty per call is the API's
// ceiling for anonymous callers.
export async function fetchWikidataLinks(qids: string[]): Promise<Map<string, WikidataLinks>> {
  const out = new Map<string, WikidataLinks>();
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50);
    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: batch.join('|'),
      props: 'sitelinks|descriptions',
      sitefilter: 'ukwiki|enwiki',
      languages: 'uk|en',
      format: 'json',
    });
    const json = await getJson<{
      entities?: Record<
        string,
        {
          missing?: string;
          descriptions?: Record<string, { value: string }>;
          sitelinks?: Record<string, { title: string }>;
        }
      >;
    }>(`https://www.wikidata.org/w/api.php?${params.toString()}`);
    for (const qid of batch) {
      const ent = json?.entities?.[qid];
      if (!ent || ent.missing != null) continue;
      out.set(qid, {
        qid,
        description: ent.descriptions?.uk?.value ?? ent.descriptions?.en?.value ?? null,
        ukwiki: ent.sitelinks?.ukwiki?.title ?? null,
        enwiki: ent.sitelinks?.enwiki?.title ?? null,
      });
    }
  }
  return out;
}

export interface WikiSummary {
  extract: string;
  description: string | null;
  wikibaseItem: string | null;
  // 'standard' for an article; 'disambiguation' and friends are not
  // something to write a landmark's detail from.
  type: string;
}

// The REST summary: lead-section text plus the entity id, which is how a
// geosearch match that came without a Wikidata id gets one.
export async function fetchWikipediaSummary(
  lang: string,
  title: string,
): Promise<WikiSummary | null> {
  const json = await getJson<{
    extract?: string;
    description?: string;
    wikibase_item?: string;
    type?: string;
  }>(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  if (!json?.extract) return null;
  return {
    extract: json.extract,
    description: json.description ?? null,
    wikibaseItem: json.wikibase_item ?? null,
    type: json.type ?? 'standard',
  };
}

// The article that sits under a name, redirects followed — "Михайло
// Грушевський" resolves to "Грушевський Михайло Сергійович". Null when
// there is no such page, or it is not an article (a category, a
// disambiguation, anything outside namespace 0). This is how a plaque
// named after a person finds the person: uk.wikipedia titles people
// "Прізвище Ім'я По батькові", which is what the mappers wrote.
export async function resolveWikipediaTitle(lang: string, name: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: 'query',
    titles: name,
    redirects: '1',
    prop: 'pageprops',
    ppprop: 'disambiguation',
    format: 'json',
  });
  const json = await getJson<{
    query?: {
      pages?: Record<string, { ns?: number; title?: string; missing?: string; pageprops?: Record<string, string> }>;
    };
  }>(`https://${lang}.wikipedia.org/w/api.php?${params.toString()}`);
  const pages = Object.values(json?.query?.pages ?? {});
  const page = pages[0];
  if (!page || page.missing != null || page.ns !== 0 || !page.title) return null;
  if (page.pageprops && 'disambiguation' in page.pageprops) return null;
  return page.title;
}

// Every article geotagged within radiusM of a point. Position only — the
// caller decides which of them, if any, is the landmark (loreMatch.ts).
export async function geosearchWikipedia(
  lang: string,
  lat: number,
  lng: number,
  radiusM: number,
): Promise<GeoCandidate[]> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'geosearch',
    gscoord: `${lat}|${lng}`,
    gsradius: String(Math.round(radiusM)),
    gslimit: '20',
    format: 'json',
  });
  const json = await getJson<{
    query?: { geosearch?: Array<{ title: string; dist: number }> };
  }>(`https://${lang}.wikipedia.org/w/api.php?${params.toString()}`);
  return (json?.query?.geosearch ?? []).map((g) => ({ title: g.title, dist: g.dist }));
}
