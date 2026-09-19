// WHY THERE IS A HOLE IN THE MIDDLE OF THE MAP.
//
// The owner looked at central Kyiv in territory view and found a white
// patch surrounded by colour. Two explanations fit that, and they point
// at opposite fixes, so guessing between them was not good enough:
//
//   the ground is unmarked   — nothing is walking there. Bot placement,
//                              stroll range, reach.
//   the ground is marked but unclaimed — plenty is walking there, and
//                              the marks cannot hold a shape.
//
// The second one is the counterintuitive one and the reason this file
// exists. A mark claims ground only as part of a hull of at least
// `shapeMinMarks` of its OWNER'S marks within `claimNeighbourM` of it
// (services/territory.ts → placeMark). Fewer than that and the hull
// comes out empty: the mark lands, costs hunger, shows a dot, and holds
// nothing. Meanwhile every rival mark within `contestM` cuts ground away
// and can kill the marks under it. So the ground that is fought over
// hardest is the ground where each owner's survivors are sparsest — and
// an area can be the busiest on the map and hold nothing at all.
//
// `lonelyMarks` is that number: marks with too few of their own kin near
// enough to ever be part of a shape. If it is a large share of the
// total, the hole is the shape rule biting, and the levers are
// `shapeMinMarks`, `claimNeighbourM`, or making raids less lethal. If it
// is small, the hole is genuinely unwalked and the levers are the bots'
// homes and ranges.
//
// Cost: one self-join over `territory_marks`, bbox-prefiltered on the
// index that table already carries, on a table that holds at most
// `botMaxMarks` × the bot pool plus whatever people have earned — about
// 1,400 rows today. It rides the two-minute metrics call, not the
// twenty-second live one.

import { pg } from '../db/index.js';
import { balance } from '../config/balance.js';

const T = balance.territory;

// Metres per degree, the same pair used everywhere else in this codebase
// (planHomes, catchUp). Equirectangular rather than haversine because at
// 250m in Kyiv the difference is centimetres and this runs inside a join.
const M_PER_LAT = 110_540;
const KYIV_LAT = 50.45;

export interface TerritoryHealth {
  marks: number;
  /** Marks that can never be part of a hull — too few of their owner's
   *  own marks within claimNeighbourM. The answer to "marked but
   *  unclaimed". */
  lonelyMarks: number;
  /** Marks whose age is within a day of markTtlDays. Ground goes with
   *  them, so a high number means the map is about to thin out. */
  expiringSoon: number;
  pieces: number;
  ownersWithGround: number;
  hectares: number;
  /** Someone marking and holding nothing. The per-owner shape of the
   *  same story lonelyMarks tells per mark. */
  ownersMarkingNothingHeld: number;
  raids24h: number;
  /** The rule itself, shipped with the numbers so the panel can explain
   *  what it is showing without a second copy of the constants. */
  shapeMinMarks: number;
  claimNeighbourM: number;
}

export async function collectTerritoryHealth(): Promise<TerritoryHealth> {
  const mPerLng = 111_320 * Math.cos((KYIV_LAT * Math.PI) / 180);
  const dLat = T.claimNeighbourM / M_PER_LAT;
  const dLng = T.claimNeighbourM / mPerLng;
  // A mark needs shapeMinMarks in the cluster INCLUDING itself, so the
  // number of OTHERS it needs is one less.
  const needPeers = T.shapeMinMarks - 1;

  const [row] = await pg`
    with peers as (
      select
        a.id,
        a.user_id,
        count(*) filter (
          where b.id <> a.id
            and sqrt(
                  power((b.lng - a.lng) * ${mPerLng}, 2) +
                  power((b.lat - a.lat) * ${M_PER_LAT}, 2)
                ) <= ${T.claimNeighbourM}
        ) as near
      from territory_marks a
      join territory_marks b
        on b.user_id = a.user_id
       and b.lat between a.lat - ${dLat} and a.lat + ${dLat}
       and b.lng between a.lng - ${dLng} and a.lng + ${dLng}
      group by a.id, a.user_id
    )
    select
      (select count(*) from territory_marks)::int as marks,
      (select count(*) from peers where near < ${needPeers})::int as lonely,
      (select count(*) from territory_marks
         where created_at < now() - make_interval(days => ${T.markTtlDays - 1}))::int as expiring,
      (select count(*) from territory_ground)::int as pieces,
      (select count(distinct user_id) from territory_ground)::int as owners_with_ground,
      (select coalesce(sum(area_m2), 0) from territory_ground)::float8 as area_m2,
      (select count(distinct user_id) from territory_marks)::int as owners_marking,
      (select count(distinct user_id) from territory_ground)::int as owners_holding,
      (select count(*) from territory_raids
         where created_at > now() - interval '24 hours')::int as raids_24h
  `;

  return {
    marks: row?.marks ?? 0,
    lonelyMarks: row?.lonely ?? 0,
    expiringSoon: row?.expiring ?? 0,
    pieces: row?.pieces ?? 0,
    ownersWithGround: row?.owners_with_ground ?? 0,
    hectares: Math.round(((row?.area_m2 ?? 0) / 10_000) * 10) / 10,
    ownersMarkingNothingHeld: Math.max(
      0,
      (row?.owners_marking ?? 0) - (row?.owners_holding ?? 0),
    ),
    raids24h: row?.raids_24h ?? 0,
    shapeMinMarks: T.shapeMinMarks,
    claimNeighbourM: T.claimNeighbourM,
  };
}

/** One line per fact, for the text report. */
export function renderTerritoryHealth(t: TerritoryHealth): string[] {
  const share = t.marks > 0 ? Math.round((t.lonelyMarks / t.marks) * 100) : 0;
  return [
    `TERRITORY  ${t.marks} marks, ${t.pieces} pieces, ${t.ownersWithGround} owners, ${t.hectares} ha`,
    `  marked but unclaimed  ${t.lonelyMarks} (${share}%) — too few of their own within ${T.claimNeighbourM}m to make a shape`,
    `  owners holding nothing ${t.ownersMarkingNothingHeld}`,
    `  raids 24h              ${t.raids24h}`,
    `  expiring within a day  ${t.expiringSoon} of ${t.marks}`,
  ];
}
