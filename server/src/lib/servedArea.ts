// WHERE THE APP IS PLAYED — the server's copy.
//
// The client reads SERVED_AREA from `@shukajpes/shared`; this file is
// the same four numbers, kept here because the server cannot load the
// shared package at runtime (its main is a .ts file and dist is plain
// node). `servedArea.check.ts` fails the build the moment they differ.
//
// Three gates share it, and that is the point: the ingest gate (a pet
// parsed outside the box is placed on the fallback, not on the map), the
// Places spend gate (a coordinate outside the box never reaches a
// billable Google call), and — since D-74 — the walker gates: /sync/map,
// /presence and /collect/path refuse a position that cannot be where
// anyone is standing, because Kyiv's air defence spoofs GPS to Lima and
// beyond whenever drones are up. No dependencies, so a check can import
// it without a database.
export const KYIV_BBOX = {
  north: 50.65,
  south: 50.2,
  west: 30.1,
  east: 30.9,
};

export function inKyivBbox(lat: number, lng: number): boolean {
  return (
    lat >= KYIV_BBOX.south &&
    lat <= KYIV_BBOX.north &&
    lng >= KYIV_BBOX.west &&
    lng <= KYIV_BBOX.east
  );
}
