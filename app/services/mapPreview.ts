import maplibregl from 'maplibre-gl';
import type { LatLng } from '@shukajpes/shared';
import { applyCrayonOverride, fetchCrayonStyleSpec, LIGHT_PALETTE } from '../components/map/crayonStyle';

// A small picture of the map around a place, for the favourites cards.
//
// The obvious sources of a static map — a tile provider's static-image
// API — cost money or a key we don't have, and would not look like OUR
// map, which is the point of the preview. So the preview IS our map:
// one hidden MapLibre instance carrying the same OpenFreeMap style and
// the same crayon override, jumped to the place, given a moment to
// settle, and read back as a PNG. One WebGL context for all cards, used
// one place at a time, and torn down when the queue empties so a tab
// nobody is looking at holds no GPU memory.
//
// Snapshots are kept in memory for the session and in localStorage
// across sessions (capped — see STORE_MAX), keyed by landmark id; the
// map around a plaque does not change week to week.

export const PREVIEW_W = 320;
export const PREVIEW_H = 150;
// Close enough to read the block the place is on, far enough to see the
// street it is on. A little tilt so it reads as the same world as the
// main map, not a flat print.
const PREVIEW_ZOOM = 15.8;
const PREVIEW_PITCH = 35;
// How long one snapshot may take before it is given up on — tiles on a
// slow connection, mostly.
const JOB_TIMEOUT_MS = 12_000;
// Idle before the hidden map is torn down.
const TEARDOWN_AFTER_MS = 20_000;

const STORE_KEY = 'shukajpes.lorePreview.v1';
const STORE_MAX = 40;

type Job = { id: string; position: LatLng; resolve: (url: string | null) => void };

const memory = new Map<string, string>();
const queue: Job[] = [];
let running = false;
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
  instance = { map, container };
  return map;
}

function teardown(): void {
  if (!instance) return;
  instance.map.remove();
  instance.container.remove();
  instance = null;
}

async function snapshot(map: maplibregl.Map, position: LatLng): Promise<string | null> {
  map.jumpTo({ center: [position.lng, position.lat], zoom: PREVIEW_ZOOM, pitch: PREVIEW_PITCH, bearing: 0 });
  const settled = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), JOB_TIMEOUT_MS);
    map.once('idle', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (!settled) return null;
  try {
    return map.getCanvas().toDataURL('image/jpeg', 0.82);
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
