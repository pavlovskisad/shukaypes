// Every number the console shows, computed in one place.
//
// ONE QUERY SET, ONE RENDERER — the same discipline lostDogsReport.ts
// already follows. The console and the CLI read the same function, so
// they cannot describe the database differently. A dashboard that
// disagrees with the database is worse than no dashboard, and this repo
// has already been bitten twice by a check that read nothing being
// reported as a check that found nothing.
//
// BOTS ARE SEPARATED STRUCTURALLY, NOT IN A FOOTNOTE. Thirty synthetic
// walkers (`bot:N`) are live in production to make presence feel
// populated. Every user-facing figure here counts real accounts only,
// and the bot count is reported beside it so nobody has to wonder which
// they are looking at. This matters beyond tidiness: engagement and
// retention numbers from the closed beta are going into a fundraise, and
// a DAU that quietly includes bots is a number that misleads an investor.
//
// Everything is a plain aggregate over tables that already exist. No
// instrumentation, no event pipeline, nothing to keep in sync.

import { pg } from '../db/index.js';

export interface Metrics {
  generatedAt: string;
  users: {
    real: number;
    bots: number;
    newLast24h: number;
    newLast7d: number;
    // Active = did something that writes a collect_event. Distinct from
    // "opened the app", which we deliberately do not track.
    dau: number;
    wau: number;
  };
  retention: {
    // Of the accounts created in each window, how many came back on a
    // LATER day. Null when the cohort is too small to mean anything —
    // "0% of 2 people" is noise that reads as a catastrophe.
    d1: { cohort: number; returned: number; pct: number | null };
    d7: { cohort: number; returned: number; pct: number | null };
  };
  pets: {
    active: number;
    expired: number;
    found: number;
    // Ungeocoded rows sitting on the city-centre fallback pin. Invisible
    // on the map: /dogs/nearby filters them out.
    onFallbackPin: number;
    addedLast7d: number;
  };
  ingest: {
    source: string;
    last7d: number;
    lastInsertAt: string | null;
    // Hours since the last row from this source actually became a pet.
    // The heartbeat that says whether a scraper is alive.
    staleHours: number | null;
  }[];
  searchFunnel: {
    // Only meaningful from 14 Aug 2026, when search_results was added.
    searchesCompleted: number;
    found: number;
    empty: number;
    sightings: number;
    searchesLast7d: number;
  };
  chat: {
    messagesLast7d: number;
    usersLast7d: number;
    inputTokensLast7d: number;
    outputTokensLast7d: number;
    cacheReadTokensLast7d: number;
    byModel: { model: string; messages: number; inputTokens: number; outputTokens: number }[];
  };
  territory: {
    marks: number;
    claimedShapes: number;
    ownersWithGround: number;
  };
}

const NOT_BOT = `id not like 'bot:%'`;

export async function collectMetrics(): Promise<Metrics> {
  const [userRow] = await pg`
    select
      count(*) filter (where id not like 'bot:%')::int as real,
      count(*) filter (where id like 'bot:%')::int as bots,
      count(*) filter (where id not like 'bot:%' and created_at > now() - interval '24 hours')::int as new_24h,
      count(*) filter (where id not like 'bot:%' and created_at > now() - interval '7 days')::int as new_7d
    from users`;

  const [activeRow] = await pg`
    select
      count(distinct user_id) filter (where at > now() - interval '24 hours')::int as dau,
      count(distinct user_id) filter (where at > now() - interval '7 days')::int as wau
    from collect_events
    where user_id not like 'bot:%'`;

  // Returned on a LATER DAY than they signed up — same-day activity is
  // just the signup session and would score 100% retention forever.
  const [d1] = await pg`
    with cohort as (
      select id, created_at from users
      where id not like 'bot:%'
        and created_at > now() - interval '8 days'
        and created_at < now() - interval '1 day'
    )
    select
      (select count(*) from cohort)::int as cohort,
      (select count(distinct c.id) from cohort c
        join collect_events e on e.user_id = c.id
       where e.at::date > c.created_at::date)::int as returned`;

  const [d7] = await pg`
    with cohort as (
      select id, created_at from users
      where id not like 'bot:%'
        and created_at > now() - interval '30 days'
        and created_at < now() - interval '7 days'
    )
    select
      (select count(*) from cohort)::int as cohort,
      (select count(distinct c.id) from cohort c
        join collect_events e on e.user_id = c.id
       where e.at::date >= c.created_at::date + 7)::int as returned`;

  const [petRow] = await pg`
    select
      count(*) filter (where status = 'active')::int as active,
      count(*) filter (where status = 'expired')::int as expired,
      count(*) filter (where status = 'found')::int as found,
      count(*) filter (where status = 'active'
        and abs(last_seen_lat - 50.4501) < 0.0005
        and abs(last_seen_lng - 30.5234) < 0.0005)::int as on_fallback_pin,
      count(*) filter (where created_at > now() - interval '7 days')::int as added_7d
    from lost_dogs`;

  const ingest = await pg`
    select
      source,
      count(*) filter (where first_seen_at > now() - interval '7 days' and dog_id is not null)::int as last_7d,
      max(first_seen_at) filter (where dog_id is not null) as last_insert_at
    from scrape_log
    group by source
    order by source`;

  const [funnel] = await pg`
    select
      (select count(*) from search_results)::int as completed,
      (select count(*) from search_results where seen)::int as found,
      (select count(*) from search_results where not seen)::int as empty,
      (select count(*) from sightings)::int as sightings,
      (select count(*) from search_results where created_at > now() - interval '7 days')::int as last_7d`;

  const [chatRow] = await pg`
    select
      count(*)::int as messages,
      count(distinct user_id)::int as users,
      coalesce(sum(input_tokens),0)::int as input_tokens,
      coalesce(sum(output_tokens),0)::int as output_tokens,
      coalesce(sum(cache_read_tokens),0)::int as cache_read_tokens
    from messages
    where created_at > now() - interval '7 days'`;

  const byModel = await pg`
    select
      coalesce(model,'(none)') as model,
      count(*)::int as messages,
      coalesce(sum(input_tokens),0)::int as input_tokens,
      coalesce(sum(output_tokens),0)::int as output_tokens
    from messages
    where created_at > now() - interval '7 days'
    group by model
    order by count(*) desc`;

  const [terr] = await pg`
    select
      (select count(*) from territory_marks)::int as marks,
      (select count(*) from territory_ground)::int as shapes,
      (select count(distinct user_id) from territory_ground)::int as owners`;

  const pct = (cohort: number, returned: number): number | null =>
    // Under ten people a percentage is theatre, not a measurement.
    cohort < 10 ? null : Math.round((returned / cohort) * 1000) / 10;

  const now = Date.now();
  return {
    generatedAt: new Date().toISOString(),
    users: {
      real: userRow?.real ?? 0,
      bots: userRow?.bots ?? 0,
      newLast24h: userRow?.new_24h ?? 0,
      newLast7d: userRow?.new_7d ?? 0,
      dau: activeRow?.dau ?? 0,
      wau: activeRow?.wau ?? 0,
    },
    retention: {
      d1: {
        cohort: d1?.cohort ?? 0,
        returned: d1?.returned ?? 0,
        pct: pct(d1?.cohort ?? 0, d1?.returned ?? 0),
      },
      d7: {
        cohort: d7?.cohort ?? 0,
        returned: d7?.returned ?? 0,
        pct: pct(d7?.cohort ?? 0, d7?.returned ?? 0),
      },
    },
    pets: {
      active: petRow?.active ?? 0,
      expired: petRow?.expired ?? 0,
      found: petRow?.found ?? 0,
      onFallbackPin: petRow?.on_fallback_pin ?? 0,
      addedLast7d: petRow?.added_7d ?? 0,
    },
    ingest: ingest.map((r) => ({
      source: r.source as string,
      last7d: r.last_7d as number,
      lastInsertAt: r.last_insert_at ? new Date(r.last_insert_at as string).toISOString() : null,
      staleHours: r.last_insert_at
        ? Math.round(((now - new Date(r.last_insert_at as string).getTime()) / 3_600_000) * 10) / 10
        : null,
    })),
    searchFunnel: {
      searchesCompleted: funnel?.completed ?? 0,
      found: funnel?.found ?? 0,
      empty: funnel?.empty ?? 0,
      sightings: funnel?.sightings ?? 0,
      searchesLast7d: funnel?.last_7d ?? 0,
    },
    chat: {
      messagesLast7d: chatRow?.messages ?? 0,
      usersLast7d: chatRow?.users ?? 0,
      inputTokensLast7d: chatRow?.input_tokens ?? 0,
      outputTokensLast7d: chatRow?.output_tokens ?? 0,
      cacheReadTokensLast7d: chatRow?.cache_read_tokens ?? 0,
      byModel: byModel.map((r) => ({
        model: r.model as string,
        messages: r.messages as number,
        inputTokens: r.input_tokens as number,
        outputTokens: r.output_tokens as number,
      })),
    },
    territory: {
      marks: terr?.marks ?? 0,
      claimedShapes: terr?.shapes ?? 0,
      ownersWithGround: terr?.owners ?? 0,
    },
  };
}

/**
 * The same numbers as text, for a terminal or a bot message. Exists so
 * "check the metrics" never requires a browser or a token in a browser.
 */
export function renderMetricsText(m: Metrics): string {
  const L: string[] = [];
  const pctText = (p: number | null, cohort: number) =>
    p == null ? `n/a (cohort ${cohort}, too small)` : `${p}%`;

  L.push(`шукайпес metrics — ${m.generatedAt}`);
  L.push('');
  L.push(`USERS  ${m.users.real} real (+${m.users.bots} bots, excluded below)`);
  L.push(`  new     ${m.users.newLast24h} in 24h, ${m.users.newLast7d} in 7d`);
  L.push(`  active  DAU ${m.users.dau}, WAU ${m.users.wau}`);
  L.push(`  D1      ${pctText(m.retention.d1.pct, m.retention.d1.cohort)} (${m.retention.d1.returned}/${m.retention.d1.cohort})`);
  L.push(`  D7      ${pctText(m.retention.d7.pct, m.retention.d7.cohort)} (${m.retention.d7.returned}/${m.retention.d7.cohort})`);
  L.push('');
  L.push(`PETS   ${m.pets.active} active, ${m.pets.found} found, ${m.pets.expired} expired`);
  L.push(`  +${m.pets.addedLast7d} in 7d`);
  L.push(`  ${m.pets.onFallbackPin} on the fallback pin (invisible on the map)`);
  L.push('');
  L.push('INGEST');
  if (m.ingest.length === 0) L.push('  (no scrape_log rows at all)');
  for (const s of m.ingest) {
    const age = s.staleHours == null ? 'never' : `${s.staleHours}h ago`;
    L.push(`  ${s.source.padEnd(10)} ${String(s.last7d).padStart(4)} in 7d   last ${age}`);
  }
  L.push('');
  L.push('SEARCH FUNNEL  (search_results starts 14 Aug 2026)');
  L.push(`  completed ${m.searchFunnel.searchesCompleted} (${m.searchFunnel.found} found, ${m.searchFunnel.empty} empty)`);
  L.push(`  last 7d   ${m.searchFunnel.searchesLast7d}`);
  L.push(`  sightings ${m.searchFunnel.sightings} ever`);
  L.push('');
  L.push(`CHAT   ${m.chat.messagesLast7d} messages from ${m.chat.usersLast7d} users in 7d`);
  L.push(`  tokens in ${m.chat.inputTokensLast7d}, out ${m.chat.outputTokensLast7d}, cache-read ${m.chat.cacheReadTokensLast7d}`);
  for (const b of m.chat.byModel) {
    L.push(`  ${b.model.padEnd(24)} ${String(b.messages).padStart(4)} msg  in ${b.inputTokens} out ${b.outputTokens}`);
  }
  L.push('');
  L.push(`TERRITORY  ${m.territory.marks} marks, ${m.territory.claimedShapes} shapes, ${m.territory.ownersWithGround} owners`);
  return L.join('\n');
}

// Referenced by the queries above; kept as a named constant so the bot
// exclusion is greppable rather than a magic string repeated eight times.
export const BOT_EXCLUSION_SQL = NOT_BOT;
