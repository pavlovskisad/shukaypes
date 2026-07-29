// Territory grid — the cell math behind scent marking.
//
// WHY A GRID
// ----------
// A mark is a soft blob of scent, but ownership has to be unambiguous:
// two dogs can't half-own the same patch of pavement. So the visual and
// the logic are deliberately separated — the client renders marks as a
// soft heat glow, while the server resolves ownership on a fixed grid of
// ~110 m cells. Every mark claims the handful of cells whose centre falls
// inside its radius, and a cell has exactly one owner.
//
// The grid is a plain lat/lng quantisation rather than H3 so the server
// carries no extra dependency and a cell id decodes to a centre with
// arithmetic alone (no lookup tables, no client-side library to render
// with).
//
// Cells stay roughly square anywhere on earth: the latitude step is
// constant, and the longitude step widens with the cosine of the cell's
// own latitude BAND (derived from latIdx, so it's deterministic — the
// same point always lands in the same cell, and cells tile without gaps).

// Cell edge in metres. ~110 m pairs with MARK_RADIUS_M below so one mark
// claims a chunky blob of 1-5 cells — big enough to read as a claim when
// zoomed out to district level, small enough that a walk carves a
// recognisable ribbon rather than swallowing a neighbourhood.
export const CELL_M = 110;

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG_EQ = 111320;

export const LAT_STEP = CELL_M / M_PER_DEG_LAT;

// Longitude step for a latitude band. Clamped near the poles so the step
// can't blow up to infinity (irrelevant for Kyiv, but keeps the maths
// total).
function lngStepForBand(latIdx: number): number {
  const bandLat = (latIdx + 0.5) * LAT_STEP;
  const cos = Math.max(0.05, Math.cos((bandLat * Math.PI) / 180));
  return CELL_M / (M_PER_DEG_LNG_EQ * cos);
}

export interface Cell {
  id: string;
  lat: number; // centre
  lng: number; // centre
}

// "latIdx.lngIdx" — compact, sortable, and decodable without a lookup.
export function cellIdAt(lat: number, lng: number): string {
  const latIdx = Math.floor(lat / LAT_STEP);
  const lngIdx = Math.floor(lng / lngStepForBand(latIdx));
  return `${latIdx}.${lngIdx}`;
}

export function cellCentre(id: string): { lat: number; lng: number } | null {
  const dot = id.indexOf('.');
  if (dot < 0) return null;
  const latIdx = Number(id.slice(0, dot));
  const lngIdx = Number(id.slice(dot + 1));
  if (!Number.isFinite(latIdx) || !Number.isFinite(lngIdx)) return null;
  return {
    lat: (latIdx + 0.5) * LAT_STEP,
    lng: (lngIdx + 0.5) * lngStepForBand(latIdx),
  };
}

// Every cell whose CENTRE lies within `radiusM` of the point. Centre-based
// (rather than any-overlap) so a mark on a cell boundary doesn't quietly
// claim twice the area it looks like it should.
export function cellsWithinRadius(
  lat: number,
  lng: number,
  radiusM: number,
): Cell[] {
  const latIdx0 = Math.floor(lat / LAT_STEP);
  const span = Math.ceil(radiusM / CELL_M) + 1;
  const out: Cell[] = [];
  for (let dLat = -span; dLat <= span; dLat++) {
    const latIdx = latIdx0 + dLat;
    const lngStep = lngStepForBand(latIdx);
    const lngIdx0 = Math.floor(lng / lngStep);
    const cLat = (latIdx + 0.5) * LAT_STEP;
    for (let dLng = -span; dLng <= span; dLng++) {
      const lngIdx = lngIdx0 + dLng;
      const cLng = (lngIdx + 0.5) * lngStep;
      // Flat-earth metres are plenty accurate at this scale.
      const dy = (cLat - lat) * M_PER_DEG_LAT;
      const dx =
        (cLng - lng) *
        M_PER_DEG_LNG_EQ *
        Math.cos((lat * Math.PI) / 180);
      if (dx * dx + dy * dy <= radiusM * radiusM) {
        out.push({ id: `${latIdx}.${lngIdx}`, lat: cLat, lng: cLng });
      }
    }
  }
  return out;
}

// Every cell whose centre falls INSIDE a closed ring of lat/lng points.
// Used by the enclosure claim: walk a loop and the ground it encircles
// becomes yours, not just the path you trod.
//
// Ray casting on the raw lat/lng plane — at city scale the projection
// distortion is far below one cell, so there's nothing to gain from
// projecting first. Bounded by `maxCells` because the caller can't know
// in advance how big a loop someone walked.
export function cellsInsideRing(
  ring: { lat: number; lng: number }[],
  maxCells: number,
): Cell[] {
  if (ring.length < 3) return [];
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of ring) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const out: Cell[] = [];
  const latIdxMin = Math.floor(minLat / LAT_STEP);
  const latIdxMax = Math.floor(maxLat / LAT_STEP);
  for (let latIdx = latIdxMin; latIdx <= latIdxMax; latIdx++) {
    const lngStep = lngStepForBand(latIdx);
    const cLat = (latIdx + 0.5) * LAT_STEP;
    const lngIdxMin = Math.floor(minLng / lngStep);
    const lngIdxMax = Math.floor(maxLng / lngStep);
    for (let lngIdx = lngIdxMin; lngIdx <= lngIdxMax; lngIdx++) {
      const cLng = (lngIdx + 0.5) * lngStep;
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i]!;
        const b = ring[j]!;
        if (
          a.lat > cLat !== b.lat > cLat &&
          cLng < ((b.lng - a.lng) * (cLat - a.lat)) / (b.lat - a.lat) + a.lng
        ) {
          inside = !inside;
        }
      }
      if (inside) {
        out.push({ id: `${latIdx}.${lngIdx}`, lat: cLat, lng: cLng });
        if (out.length >= maxCells) return out;
      }
    }
  }
  return out;
}

// Are these two cells edge- or corner-adjacent? Used by the connected-range
// walk (slice 3's bonuses scale with the largest connected region, and an
// island is worth less than the mainland).
export function areNeighbours(a: string, b: string): boolean {
  const da = a.indexOf('.');
  const db = b.indexOf('.');
  if (da < 0 || db < 0) return false;
  const dLat = Math.abs(Number(a.slice(0, da)) - Number(b.slice(0, db)));
  const dLng = Math.abs(Number(a.slice(da + 1)) - Number(b.slice(db + 1)));
  return dLat <= 1 && dLng <= 1 && dLat + dLng > 0;
}
