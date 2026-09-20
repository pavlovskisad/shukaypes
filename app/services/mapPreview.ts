import maplibregl from 'maplibre-gl';
import type { LatLng } from '@shukajpes/shared';
import {
  applyCrayonOverride,
  fetchCrayonStyleSpec,
  firstSymbolLayerId,
  hideMapLibreBuildings,
  LIGHT_PALETTE,
} from '../components/map/crayonStyle';
import { FLAT_PITCH, WALK_ZOOM } from '../components/map/camera';

// A small picture of the map around a place, for the favourites cards.
//
// The obvious sources of a static map — a tile provider's static-image
// API — cost money or a key we don't have, and would not look like OUR
// map, which is the point of the preview. So the preview IS our map:
// one hidden MapLibre instance carrying the same OpenFreeMap style and
// the same crayon override and the same three.js city, jumped to the
// place, given a moment to settle, and read back as a JPEG. One WebGL
// context for all cards, used one place at a time, and torn down when
// the queue empties so a tab nobody is looking at holds no GPU memory.
//
// Snapshots are kept in memory for the session and in localStorage
// across sessions (capped — see STORE_MAX), keyed by landmark id; the
// map around a plaque does not change week to week.

export const PREVIEW_W = 320;
// NOT the height the picture is shown at — the card flexes that, so
// the paper band under it is exactly as tall as one card's title and
// story need (164 when both run to two lines, 204 when both are one).
// This is what the hidden map is RENDERED at, and the middle of that
// range is the size that crops least at either end.
//
// It is also the snapshot's shape, so changing it invalidates every
// cached picture — which is what the store key's version is for.
export const PREVIEW_H = 184;
// SHOT FROM WHERE THE WALKING CAMERA STANDS (D-101). This used to be a
// distance and a tilt of its own — 15.8 and 35° — picked to look nice in
// isolation. It did, and that was the bug: the card is a shortcut into a
// place you then walk to, and the walk shows you that place from
// overhead. A tilted preview is a picture of a city you never see, so
// tapping one is a small dislocation every time.
//
// Both numbers now come from components/map/camera, which is where the
// walk itself reads them. If the walking camera is ever re-aimed, these
// follow it without anybody remembering to.
//
// A STEP FURTHER OUT THAN THE WALK, though, and deliberately: the walk's
// distance is the street you are on and the next one, which is the right
// question when you are standing in it and the wrong one for a picture
// the size of a postage stamp. One zoom level back doubles the ground in
// frame, so the card shows the block the place is on rather than the
// corner of it. The tilt is not negotiable in the same way — that is the
// dislocation this set out to fix — so only the distance moves.
const PREVIEW_ZOOM_OUT = 1;
const PREVIEW_ZOOM = WALK_ZOOM - PREVIEW_ZOOM_OUT;
const PREVIEW_PITCH = FLAT_PITCH;
// How long one snapshot may take before it is given up on — tiles on a
// slow connection, mostly.
const JOB_TIMEOUT_MS = 12_000;
// Idle before the hidden map is torn down.
const TEARDOWN_AFTER_MS = 20_000;

// VERSIONED, and the version is the point. Snapshots are kept across
// sessions because the map around a plaque does not change week to week
// — which also means a phone that has already cached an older picture
// would go on showing it forever. Bumping the key is how the
// regeneration actually happens; the old entries fall out with the cap.
// v1 was the tilted 15.8 render, v2 the flat one with MapLibre's own
// buildings composited onto black.
const STORE_KEY = 'shukajpes.lorePreview.v3';
const STORE_MAX = 40;

type Job = { id: string; position: LatLng; resolve: (url: string | null) => void };

const memory = new Map<string, string>();
const queue: Job[] = [];
let running = false;
// Whether the hidden map got the three.js city. Read by the snapshot,
// which has to wait a frame longer when it did — see snapshot().
let threeCity = false;
let instance: { map: maplibregl.Map; container: HTMLDivElement } | null = null;
let teardownTimer: ReturnType<typeof setTimeout> | null = null;

function readStore(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeStore(id: string, url: string): void {
  try {
    const store = readStore();
    delete store[id];
    store[id] = url;
    const keys = Object.keys(store);
    // Oldest first — insertion order — so the cap drops what was saved
    // longest ago.
    for (let i = 0; i < keys.length - STORE_MAX; i++) delete store[keys[i]!];
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Quota or a private window: the memory cache still has it.
  }
}

export function cachedLorePreview(id: string): string | null {
  const hit = memory.get(id);
  if (hit) return hit;
  const stored = readStore()[id];
  if (stored) memory.set(id, stored);
  return stored ?? null;
}

async function ensureInstance(): Promise<maplibregl.Map> {
  if (instance) return instance.map;
  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${PREVIEW_W}px`,
    height: `${PREVIEW_H}px`,
    pointerEvents: 'none',
  });
  document.body.appendChild(container);
  const style = (await fetchCrayonStyleSpec()) as maplibregl.StyleSpecification;
  const map = new maplibregl.Map({
    container,
    style,
    center: [30.5234, 50.4501],
    zoom: PREVIEW_ZOOM,
    pitch: PREVIEW_PITCH,
    interactive: false,
    attributionControl: false,
    // Needed to read the canvas back after a frame.
    canvasContextAttributes: { preserveDrawingBuffer: true },
    pixelRatio: Math.min(2, window.devicePixelRatio || 1),
  });
  await new Promise<void>((resolve) => map.once('load', () => resolve()));
  applyCrayonOverride(map, LIGHT_PALETTE, 'uk');
  // THE CRAYON OVERRIDE IS NOT THE WHOLE OF OUR MAP (D-102). What the
  // walker sees is the override PLUS the three.js city that MapView
  // adds on top of it — pale volumes, one low sun, a soft shadow each.
  // Without it the preview falls back to MapLibre's own flat footprints,
  // which is the "harsh" the owner spotted: the same streets drawn as
  // hard cutouts instead of a lit model.
  //
  // Dynamically imported for the same reason MapView does it — three.js
  // is the second-largest thing in the bundle. When the chunk or WebGL2
  // is not there we keep MapLibre's buildings and still get a readable
  // picture, so a device that cannot run the game render is not left
  // with a city of blank holes.
  //
  // NOT the ground fog, which is the other half of MapView's game
  // render: it drives its own repaint loop for the god-rays, and a map
  // that repaints forever never fires `idle` — which is the one event
  // the snapshot below waits for.
  try {
    const gameRender = await import('../components/map/gameRender');
    map.addLayer(gameRender.createThreeBuildingsLayer(), firstSymbolLayerId(map));
    hideMapLibreBuildings(map);
    threeCity = true;
  } catch {
    threeCity = false;
  }
  instance = { map, container };
  return map;
}

function teardown(): void {
  if (!instance) return;
  instance.map.remove();
  instance.container.remove();
  instance = null;
  // The next instance decides for itself whether it got the city.
  threeCity = false;
}

// Wait for the map to come to rest, at most once per JOB_TIMEOUT_MS.
function settle(map: maplibregl.Map): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), JOB_TIMEOUT_MS);
    map.once('idle', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function snapshot(map: maplibregl.Map, position: LatLng): Promise<string | null> {
  map.jumpTo({ center: [position.lng, position.lat], zoom: PREVIEW_ZOOM, pitch: PREVIEW_PITCH, bearing: 0 });
  if (!(await settle(map))) return null;
  // THE CITY IS BUILT ON THAT FIRST IDLE, NOT BEFORE IT. The three.js
  // layer re-extrudes what is in view from the tiles it can query, and
  // it does that on `idle` — the same event we just woke on. So the
  // frame we are standing in is the one with the OLD city in it (on the
  // first place of a session, no city at all), and the rebuild asks for
  // one more frame when it is done. Wait for that one. A false here
  // means it had nothing to rebuild, which is a perfectly good frame.
  if (threeCity) await settle(map);
  try {
    // ONTO PAPER, NOT ONTO BLACK. JPEG has no alpha, so every pixel the
    // map left even slightly transparent is composited against the
    // canvas's own black — which is exactly what turned building
    // footprints into dark grey slabs in v2, on a map whose buildings
    // are white. Drawing through a 2D canvas that is painted paper
    // first puts the missing alpha where it belongs.
    const flat = document.createElement('canvas');
    const src = map.getCanvas();
    flat.width = src.width;
    flat.height = src.height;
    const ctx = flat.getContext('2d');
    if (!ctx) return src.toDataURL('image/jpeg', 0.82);
    ctx.fillStyle = LIGHT_PALETTE.paper;
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(src, 0, 0);
    return flat.toDataURL('image/jpeg', 0.82);
  } catch {
    return null;
  }
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  if (teardownTimer) {
    clearTimeout(teardownTimer);
    teardownTimer = null;
  }
  try {
    const map = await ensureInstance();
    while (queue.length > 0) {
      const job = queue.shift()!;
      const cached = cachedLorePreview(job.id);
      if (cached) {
        job.resolve(cached);
        continue;
      }
      const url = await snapshot(map, job.position);
      if (url) {
        memory.set(job.id, url);
        writeStore(job.id, url);
      }
      job.resolve(url);
    }
  } catch {
    // The style did not load, or WebGL is unavailable: every waiting
    // card gets null and shows its placeholder.
    while (queue.length > 0) queue.shift()!.resolve(null);
  } finally {
    running = false;
    teardownTimer = setTimeout(teardown, TEARDOWN_AFTER_MS);
  }
}

// The preview for a place — from cache at once, else rendered in turn.
// Resolves null when a preview cannot be made; the card shows a
// placeholder and tries again next time it mounts.
export function getLorePreview(id: string, position: LatLng): Promise<string | null> {
  const cached = cachedLorePreview(id);
  if (cached) return Promise.resolve(cached);
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    queue.push({ id, position, resolve });
    void drain();
  });
}
