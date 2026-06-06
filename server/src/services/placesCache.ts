// Server-side Places cache. Stops paying Google Places per user-pan
// by sharing results across all users + sessions in `places_cache`.
//
// Layout:
//   - Kyiv discretised into a 0.01° grid (~1.1 km × 0.7 km cells).
//   - Each (cell, category) row holds up to 20 spots from Google's
//     searchNearby for that cell + category.
//   - A client request for (lat, lng) covers the cells inside a
//     2-cell radius of that point, merges + dedupes the spots, and
//     returns whatever falls inside the requested radius.
//
// TTL is 14 days — long enough that ongoing cost flattens to almost
// nothing, short enough that a closed café eventually drops. Stale
// rows are refreshed lazily on access; if Google fails for any
// reason we return the stale data instead of dropping the user.

import { and, eq, sql } from 'drizzle-orm';
import { db, schema, type CachedPlace } from '../db/index.js';

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';
const FIELD_MASK =
  'places.id,places.displayName,places.location,places.rating,places.formattedAddress,places.primaryType';
const TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CELL_DEG = 0.01;
// Per-cell Google fetch radius — must cover the cell's diagonal plus
// a little so spots near a cell edge still surface in queries that
// hit the neighbouring cell. 0.01° cell ≈ 1.1 km × 0.7 km → diagonal
// ≈ 1.3 km. 900 m radius from cell centre covers the cell fully.
const PER_CELL_FETCH_RADIUS_M = 900;

const TYPE_FOR_CATEGORY: Record<string, string> = {
  cafe: 'cafe',
  restaurant: 'restaurant',
  bar: 'bar',
  pet_store: 'pet_store',
  veterinary_care: 'veterinary_care',
  park: 'park',
};

const EMOJI_FOR_CATEGORY: Record<string, string> = {
  cafe: '☕',
  restaurant: '🍜',
  bar: '🍹',
  pet_store: '🐶',
  veterinary_care: '⛑️',
  park: '🌳',
};

interface GoogleNewPlace {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude: number; longitude: number };
  rating?: number;
  formattedAddress?: string;
  primaryType?: string;
}

function snapToCell(lat: number, lng: number): { cellLat: number; cellLng: number } {
  return {
    cellLat: Math.round(lat / CELL_DEG) * CELL_DEG,
    cellLng: Math.round(lng / CELL_DEG) * CELL_DEG,
  };
}

// Which cells intersect the request circle, computed as a square
// neighbourhood around the snapped centre cell. Radius is in metres;
// 1° lat ≈ 111 km, lng narrows by cos(lat). Slight over-coverage is
// fine — extra cells just become cache hits.
function coveredCells(
  lat: number,
  lng: number,
  radiusM: number,
): Array<{ cellLat: number; cellLng: number }> {
  const latRangeDeg = radiusM / 111320;
  const lngRangeDeg = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const cellsLat = Math.ceil(latRangeDeg / CELL_DEG);
  const cellsLng = Math.ceil(lngRangeDeg / CELL_DEG);
  const { cellLat: cLat, cellLng: cLng } = snapToCell(lat, lng);
  const out: Array<{ cellLat: number; cellLng: number }> = [];
  for (let i = -cellsLat; i <= cellsLat; i++) {
    for (let j = -cellsLng; j <= cellsLng; j++) {
      out.push({
        cellLat: +(cLat + i * CELL_DEG).toFixed(2),
        cellLng: +(cLng + j * CELL_DEG).toFixed(2),
      });
    }
  }
  return out;
}

function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function fetchGooglePlaces(
  cellLat: number,
  cellLng: number,
  category: string,
): Promise<CachedPlace[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY is not set');
  const type = TYPE_FOR_CATEGORY[category];
  if (!type) throw new Error(`unknown category: ${category}`);
  const res = await fetch(PLACES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: [type],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: cellLat, longitude: cellLng },
          radius: PER_CELL_FETCH_RADIUS_M,
        },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`places ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { places?: GoogleNewPlace[] };
  const out: CachedPlace[] = [];
  for (const r of data.places ?? []) {
    if (!r.id || !r.location) continue;
    // Trust Google's primaryType when it matches one of our slots,
    // else fall back to the category we asked for.
    const resolvedCat =
      Object.keys(TYPE_FOR_CATEGORY).find(
        (c) => TYPE_FOR_CATEGORY[c] === r.primaryType,
      ) ?? category;
    out.push({
      id: r.id,
      name: r.displayName?.text ?? '(unnamed)',
      category: resolvedCat,
      position: { lat: r.location.latitude, lng: r.location.longitude },
      rating: r.rating,
      address: r.formattedAddress,
      icon: EMOJI_FOR_CATEGORY[resolvedCat],
    });
  }
  return out;
}

// Read all covered cells for a category, refresh stale ones, return
// the merged + filtered set. Failures on a single cell fetch fall
// back to that cell's stale row (if any) — never let one bad call
// drop the whole response.
async function loadCategory(
  center: { lat: number; lng: number },
  radiusM: number,
  category: string,
): Promise<CachedPlace[]> {
  const cells = coveredCells(center.lat, center.lng, radiusM);
  // Bulk-read every covered cell in one query.
  const rows = await db
    .select({
      cellLat: schema.placesCache.cellLat,
      cellLng: schema.placesCache.cellLng,
      spots: schema.placesCache.spots,
      fetchedAt: schema.placesCache.fetchedAt,
    })
    .from(schema.placesCache)
    .where(
      and(
        eq(schema.placesCache.category, category),
        sql`(${schema.placesCache.cellLat}, ${schema.placesCache.cellLng}) IN ${sql.raw(
          '(' + cells.map((c) => `(${c.cellLat}, ${c.cellLng})`).join(',') + ')',
        )}`,
      ),
    );
  const byKey = new Map<string, { spots: CachedPlace[]; fetchedAt: Date }>();
  for (const r of rows) {
    byKey.set(`${r.cellLat}_${r.cellLng}`, {
      spots: r.spots,
      fetchedAt: r.fetchedAt,
    });
  }
  const now = Date.now();
  const allSpots: CachedPlace[] = [];
  // Walk cells in parallel; per-cell try/catch so a single Google
  // failure doesn't poison the whole response.
  await Promise.all(
    cells.map(async (c) => {
      const key = `${c.cellLat}_${c.cellLng}`;
      const cached = byKey.get(key);
      const fresh = cached && now - cached.fetchedAt.getTime() < TTL_MS;
      if (fresh) {
        allSpots.push(...cached.spots);
        return;
      }
      try {
        const fetched = await fetchGooglePlaces(c.cellLat, c.cellLng, category);
        allSpots.push(...fetched);
        await db
          .insert(schema.placesCache)
          .values({
            cellLat: c.cellLat,
            cellLng: c.cellLng,
            category,
            spots: fetched,
            fetchedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              schema.placesCache.cellLat,
              schema.placesCache.cellLng,
              schema.placesCache.category,
            ],
            set: { spots: fetched, fetchedAt: new Date() },
          });
      } catch {
        // Google blip — serve stale if we have anything, else skip.
        if (cached) allSpots.push(...cached.spots);
      }
    }),
  );
  return allSpots;
}

export async function nearbySpots(
  center: { lat: number; lng: number },
  radiusM: number,
  categories: string[],
): Promise<CachedPlace[]> {
  const perCategory = await Promise.all(
    categories.map((cat) => loadCategory(center, radiusM, cat)),
  );
  // Dedupe by id across categories; keep first occurrence so the
  // earlier-listed category wins primaryType disagreements.
  const byId = new Map<string, CachedPlace>();
  for (const list of perCategory) {
    for (const s of list) {
      if (!byId.has(s.id)) byId.set(s.id, s);
    }
  }
  return Array.from(byId.values())
    .filter((s) => haversineM(center, s.position) <= radiusM)
    .sort((a, b) => haversineM(center, a.position) - haversineM(center, b.position));
}
