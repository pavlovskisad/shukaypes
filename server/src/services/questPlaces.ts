// Snap detective-quest stops onto real named places.
//
// generateDetectiveWaypoints lays a geometric scent-trail; on its own each
// stop is a bare coordinate that can land mid-block or in a courtyard. Here we
// pull each stop onto the nearest real place from the kyiv_gazetteer (parks,
// squares, metro entrances, notable buildings) within a short radius, so a
// stop becomes "the bench by Mariinsky Park" instead of a random dot — and we
// hand the place names back so the clue narration can name them.
//
// One bounding-box query for the whole (small) trail, then a greedy nearest
// match locally — no per-stop round-trip. Fail-soft: any DB hiccup leaves the
// stops exactly as they were with no names.

import { and, gte, lte, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { distanceMeters } from '../utils/geo.js';
import type { StoredWaypoint } from '../db/schema.js';

// How close a gazetteer place must be to a stop to snap it there.
const SNAP_RADIUS_M = 140;
// Point-like categories that read as "check here" spots. Streets, districts
// and neighbourhoods are lines/areas whose single coordinate is arbitrary, so
// they're excluded.
const SNAP_CATEGORIES = ['park', 'square', 'metro', 'building'];

export interface PlacedWaypoints {
  waypoints: StoredWaypoint[];
  placeNames: (string | null)[];
}

export async function snapWaypointsToPlaces(
  waypoints: StoredWaypoint[],
): Promise<PlacedWaypoints> {
  if (waypoints.length === 0) return { waypoints, placeNames: [] };

  const lats = waypoints.map((w) => w.position.lat);
  const lngs = waypoints.map((w) => w.position.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const padLat = (SNAP_RADIUS_M + 20) / 110540;
  const padLng =
    (SNAP_RADIUS_M + 20) / (111320 * Math.cos((midLat * Math.PI) / 180) || 111320);

  let candidates: { name: string; lat: number; lng: number }[];
  try {
    const rows = await db
      .select({
        nameUk: schema.kyivGazetteer.nameUk,
        nameEn: schema.kyivGazetteer.nameEn,
        lat: schema.kyivGazetteer.lat,
        lng: schema.kyivGazetteer.lng,
      })
      .from(schema.kyivGazetteer)
      .where(
        and(
          gte(schema.kyivGazetteer.lat, Math.min(...lats) - padLat),
          lte(schema.kyivGazetteer.lat, Math.max(...lats) + padLat),
          gte(schema.kyivGazetteer.lng, Math.min(...lngs) - padLng),
          lte(schema.kyivGazetteer.lng, Math.max(...lngs) + padLng),
          inArray(schema.kyivGazetteer.category, SNAP_CATEGORIES),
        ),
      )
      .limit(200);
    candidates = rows.map((r) => ({
      name: r.nameUk || r.nameEn || '',
      lat: r.lat,
      lng: r.lng,
    }));
  } catch {
    return { waypoints, placeNames: waypoints.map(() => null) };
  }

  const used = new Set<number>();
  const outWaypoints: StoredWaypoint[] = [];
  const placeNames: (string | null)[] = [];

  for (const w of waypoints) {
    let bestIdx = -1;
    let bestDist = SNAP_RADIUS_M;
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i)) continue;
      const c = candidates[i];
      if (!c) continue;
      const d = distanceMeters(w.position, { lat: c.lat, lng: c.lng });
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const chosen = bestIdx >= 0 ? candidates[bestIdx] : undefined;
    if (chosen && chosen.name) {
      used.add(bestIdx);
      outWaypoints.push({
        ...w,
        position: { lat: chosen.lat, lng: chosen.lng },
      });
      placeNames.push(chosen.name);
    } else {
      outWaypoints.push(w);
      placeNames.push(null);
    }
  }

  return { waypoints: outWaypoints, placeNames };
}
