// WHO IS ACTUALLY USING THIS, for the console.
//
// The owner, looking at "72 real accounts": "interesting who are they?)".
// The honest answer starts by refusing the question's premise. That
// number is every row in `users` that is not a bot, and most of them are
// ANONYMOUS: a device id minted the first time somebody opened the app,
// months before the door (D-72) existed, with no name they chose, no
// email, and often a single session. Counting those next to people who
// registered, verified an address and named a dog flatters the number and
// tells you nothing.
//
// So the panel splits them, and the split is the point:
//
//   REGISTERED  — went through the door: has `registered_at`. A person.
//   ANONYMOUS   — a device row. Might be a person who looked once, might
//                 be the same person on a second phone.
//
// THE ADDRESS IS MASKED IN THE SERVICE, not in the page (lib/maskEmail).
// The full string never reaches the browser, so no toggle in the markup
// and no screenshot can reveal it. See that file for why.
//
// Bots are excluded outright — they are not accounts in any sense this
// panel means, and their rows would be 120 of the loudest noise here.

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { maskEmail } from '../lib/maskEmail.js';

export interface AccountRow {
  id: string;
  username: string;
  registered: boolean;
  email: string | null; // masked, or null when there is none
  verified: boolean;
  pet: string | null;
  species: string | null;
  breed: string | null;
  avatar: boolean;
  telegram: string | null;
  points: number;
  distanceKm: number;
  createdAt: string;
  lastSeenAt: string;
  registeredAt: string | null;
}

export interface Accounts {
  at: string;
  summary: {
    total: number;
    registered: number;
    anonymous: number;
    verified: number;
    withPet: number;
    withAvatar: number;
    viaTelegram: number;
    activeLast7d: number;
  };
  // Registered first, then anonymous, each newest first — the order the
  // question is actually asked in.
  rows: AccountRow[];
}

interface Raw {
  id: string;
  username: string;
  email: string | null;
  email_verified_at: string | null;
  registered_at: string | null;
  pet_name: string | null;
  pet_species: string | null;
  pet_breed: string | null;
  avatar_file_id: string | null;
  telegram_username: string | null;
  telegram_id: number | null;
  points: number;
  total_distance_meters: number;
  created_at: string;
  last_seen_at: string;
}

// Enough to see everyone in a beta and not enough to build a page that
// takes a second to render. If the list ever outgrows this, it wants
// paging and a search box, not a bigger number.
const LIMIT = 300;

export async function collectAccounts(): Promise<Accounts> {
  const [summaryRows, rows] = await Promise.all([
    db.execute(sql`
      select
        count(*)::int                                                          as total,
        count(*) filter (where registered_at is not null)::int                 as registered,
        count(*) filter (where registered_at is null)::int                     as anonymous,
        count(*) filter (where email_verified_at is not null)::int             as verified,
        count(*) filter (where pet_name is not null)::int                      as with_pet,
        count(*) filter (where avatar_file_id is not null)::int                as with_avatar,
        count(*) filter (where telegram_id is not null)::int                   as via_telegram,
        count(*) filter (where last_seen_at >= now() - interval '7 days')::int as active_7d
      from users where id not like 'bot:%'
    `) as unknown as Promise<Array<Accounts['summary'] & Record<string, number>>>,
    db.execute(sql`
      select id, username, email, email_verified_at, registered_at,
             pet_name, pet_species, pet_breed, avatar_file_id,
             telegram_username, telegram_id, points, total_distance_meters,
             created_at, last_seen_at
      from users
      where id not like 'bot:%'
      order by (registered_at is null), coalesce(registered_at, created_at) desc
      limit ${LIMIT}
    `) as unknown as Promise<Raw[]>,
  ]);

  const s = (summaryRows as unknown as Array<Record<string, number>>)[0] ?? {};
  return {
    at: new Date().toISOString(),
    summary: {
      total: s.total ?? 0,
      registered: s.registered ?? 0,
      anonymous: s.anonymous ?? 0,
      verified: s.verified ?? 0,
      withPet: s.with_pet ?? 0,
      withAvatar: s.with_avatar ?? 0,
      viaTelegram: s.via_telegram ?? 0,
      activeLast7d: s.active_7d ?? 0,
    },
    rows: (rows as unknown as Raw[]).map((r) => ({
      id: r.id,
      username: r.username,
      registered: r.registered_at != null,
      email: maskEmail(r.email),
      verified: r.email_verified_at != null,
      pet: r.pet_name,
      species: r.pet_species,
      breed: r.pet_breed,
      avatar: r.avatar_file_id != null,
      telegram: r.telegram_username ?? (r.telegram_id != null ? String(r.telegram_id) : null),
      points: r.points ?? 0,
      distanceKm: Math.round(((r.total_distance_meters ?? 0) / 1000) * 10) / 10,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      registeredAt: r.registered_at,
    })),
  };
}

export function renderAccountsText(a: Accounts): string {
  const L: string[] = [];
  const s = a.summary;
  L.push(`accounts — ${a.at}`);
  L.push('');
  L.push(`${s.total} rows, bots excluded`);
  L.push(`  registered  ${s.registered}  (${s.verified} verified, ${s.withPet} named a pet, ${s.withAvatar} drew an avatar)`);
  L.push(`  anonymous   ${s.anonymous}  (device rows, no door)`);
  L.push(`  telegram    ${s.viaTelegram}`);
  L.push(`  seen in 7d  ${s.activeLast7d}`);
  L.push('');
  for (const r of a.rows) {
    const who = `${r.username}${r.pet ? ` · ${r.pet}` : ''}`;
    const mail = r.email ? `${r.email}${r.verified ? ' ✓' : ' (unverified)'}` : '—';
    L.push(
      `${r.registered ? 'R' : 'a'} ${who.padEnd(28).slice(0, 28)} ${mail.padEnd(26).slice(0, 26)} ` +
        `${String(r.points).padStart(5)}p ${String(r.distanceKm).padStart(6)}km  last seen ${r.lastSeenAt.slice(0, 16)}`,
    );
  }
  return L.join('\n') + '\n';
}
