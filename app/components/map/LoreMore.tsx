import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMaplibreMap } from './MapContext';
import {
  clampExtract,
  fetchWikipediaExtract,
  wikipediaArticleUrl,
} from '../../services/wikipedia';
import type { LoreRef } from '../../services/api';
import { useGameStore } from '../../stores/gameStore';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { VOICE } from '../../constants/voice';
import { playPop } from '../../utils/popOnTap';
import { useStrings } from '../../i18n/useStrings';

// The "read more" under a landmark's one-line story, and the heart in
// the corner above it. One component for both places a kyiv_lore row is
// shown — the sniff-press bubble and a walk stop — so the two can't
// drift on what "more" means.
//
// What's behind the button, in the order it appears:
//
//   1. The dog's own longer telling (kyiv_lore.detail), when the row has
//      one. Already on the phone, so it shows the instant the button is
//      tapped — no spinner, no network, no Wikipedia dependency.
//   2. The Wikipedia lead, when the row has an article. Fetched LAZILY
//      on the first expand — most landmarks the walker glances at and
//      moves on from. Shown in full: there is room to scroll now, and
//      the old three-line clamp under a detail read as text cut off for
//      no reason.
//   3. A link to the article itself. The lead is CC-BY-SA text shown
//      as-is, and the link is its attribution; it is also where the
//      walker who wants the whole story goes.
//
// A row with neither gets the same in-voice shrug the button always
// gave, so the affordance never reads as broken. The shrug is meant to
// be rare now: enrich-lore.ts exists to make it so.
//
// Owns its own open/fetched state. Callers reset it by remounting —
// `key={lore.id}` on a bubble that changes landmark, or unmounting the
// bubble when it closes — rather than by reaching in.

// ONE BLOCK, WITH A CEILING. The block grows in place under the story
// — one piece of paper, not a bubble and a sheet — but a long detail
// plus the Wikipedia lead is taller than the strip of screen between
// the HUD and the tab bar, and no pan can fit a thing taller than the
// window: a first cut panned and lost either the title under the HUD
// or the button under the tab bar; a second moved the text into a
// separate sheet, which fitted and looked like two things. So the
// grown part is capped at what the strip has left once the title, the
// story, the toggle and the walk button have taken theirs, and scrolls
// inside itself past that.
//
// A scroll box inside a map marker fights the map for the finger: the
// marker sits inside MapLibre's canvas container, whose handlers see
// every touch that bubbles up and turn it into a pan. So the box stops
// touch, pointer and wheel events from bubbling, with NATIVE listeners
// — React's synthetic stopPropagation runs at the React root, which is
// above the map container, too late.
//
// Both edges are MEASURED from the DOM, and measured at the thing the
// eye sees rather than at its container. The HUD's pill row carries
// id="map-hud-row" and the quest row under it id="map-hud-quest" — the
// strip that holds both (id="map-hud") ends under an EMPTY quest row
// most of the time, and measuring it put the top edge a row too low,
// so the bubble looked as if it did not fit and lost its title to the
// HUD. The tab bar is the page's role="tab" buttons, whose top is the
// pill's top whatever the navigator wraps them in. Earlier cuts
// guessed both as constants and got it wrong both ways, because
// Safari's own bar changes where the container ends and a constant
// cannot know. The constants remain only as fallbacks for a DOM that
// has none of these.
//
// The gap kept on each side is the bubble's own rhythm: the same S.s
// that separates the bubble from its button.
const EDGE_GAP_PX = S.s;
const FALLBACK_TOP_PX = 140;
const FALLBACK_BOTTOM_PX = 200;
// The grown part never shrinks below this, whatever the strip has
// left — on a very short viewport the bubble's top may go under the
// HUD, but the text stays readable.
const MORE_MIN_PX = 120;
// Below this the pan is a twitch, not a fix.
const MIN_PAN_PX = 4;
const PAN_MS = 320;
// How many times one trigger may re-measure and pan again: the second
// pass catches a first pan measured against a frame that moved under
// it; a third would be chasing sub-pixel noise.
const MAX_PASSES = 2;

// Where the tab bar starts: the highest top among the visible tab
// buttons. Falls back to the widest visible tablist, then to nothing.
function tabBarTop(): number | null {
  let top: number | null = null;
  for (const el of Array.from(document.querySelectorAll('[role="tab"]'))) {
    const r = el.getBoundingClientRect();
    if (r.height === 0) continue;
    if (top === null || r.top < top) top = r.top;
  }
  if (top !== null) return top;
  let best: DOMRect | null = null;
  for (const el of Array.from(document.querySelectorAll('[role="tablist"]'))) {
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.width < 100) continue;
    if (!best || r.width > best.width) best = r;
  }
  return best ? best.top : null;
}

// Where the HUD ends: the pill row's bottom, or the quest row's when
// it is showing something. The whole strip is the last resort.
function hudBottom(): number | null {
  const row = document.getElementById('map-hud-row')?.getBoundingClientRect();
  const questEl = document.getElementById('map-hud-quest');
  // The quest row is always laid out; it counts only when something
  // inside it has height.
  const questContent = questEl?.firstElementChild?.firstElementChild;
  const quest =
    questContent && questContent.getBoundingClientRect().height > 0
      ? questEl!.getBoundingClientRect()
      : null;
  if (row) return quest ? Math.max(row.bottom, quest.bottom) : row.bottom;
  const strip = document.getElementById('map-hud')?.getBoundingClientRect();
  return strip ? strip.bottom : null;
}

// The strip of viewport between the HUD and the tab bar, in viewport px.
function viewportBand(): { top: number; bottom: number } {
  const hud = hudBottom();
  const tabs = tabBarTop();
  return {
    top: (hud ?? FALLBACK_TOP_PX) + EDGE_GAP_PX,
    bottom: (tabs ?? window.innerHeight - FALLBACK_BOTTOM_PX) - EDGE_GAP_PX,
  };
}

// The events MapLibre turns into a pan or a zoom when they reach its
// container. Stopped at the scroll box so a finger on the text scrolls
// the text.
const MAP_GESTURE_EVENTS = ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'mousedown', 'wheel'];

export type LoreMoreSource = Pick<LoreRef, 'detail' | 'wikipediaTitle' | 'sourceLang'>;

type Tone = 'paper' | 'voice';

export function LoreMore({
  lore,
  tone,
}: {
  lore: LoreMoreSource;
  // The bubble this sits in: the sniff bubble is white paper, a walk
  // stop is the dog's dark voice. Only the hairline and the scroll fade
  // change.
  tone: Tone;
}) {
  const t = useStrings();
  const map = useMaplibreMap();
  // The toggle is always rendered, so it is the stable handle on the
  // bubble this block lives in.
  const toggleRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [extract, setExtract] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // The ceiling on the grown part, from the DOM; null until measured.
  const [maxMore, setMaxMore] = useState<number | null>(null);
  // Whether the box has more below its fold — drives the fade.
  const [canScroll, setCanScroll] = useState(false);

  const hasWiki = !!lore.wikipediaTitle && !!lore.sourceLang;

  // The ceiling: the strip minus everything in the marker that is not
  // this block — the bubble's fixed part above and below it, and the
  // walk button under the bubble on a sniff. Before paint, so the first
  // frame is already capped. Measured ONCE per open: a first cut also
  // re-measured on window resize, and on iOS a drag inside the box can
  // nudge Safari's bars, which fires resize, which re-sized the bubble
  // under the finger.
  useLayoutEffect(() => {
    if (!open) {
      setMaxMore(null);
      return;
    }
    const bubbleEl = toggleRef.current?.parentElement;
    const moreEl = moreRef.current;
    if (!bubbleEl || !moreEl) return;
    const markerEl = bubbleEl.closest('.maplibregl-marker');
    const footEl = markerEl?.querySelector('[data-lore-foot]');
    const band = viewportBand();
    const fixed = bubbleEl.getBoundingClientRect().height - moreEl.getBoundingClientRect().height;
    const foot = footEl ? footEl.getBoundingClientRect().height + S.s : 0;
    const room = band.bottom - band.top - fixed - foot;
    setMaxMore(Math.max(MORE_MIN_PX, Math.floor(room)));
  }, [open]);

  // Keep the map's fingers off the text, and know whether there is more
  // below the fold.
  useEffect(() => {
    const el = moreRef.current;
    if (!open || !el) return;
    const stop = (e: Event) => e.stopPropagation();
    for (const name of MAP_GESTURE_EVENTS) el.addEventListener(name, stop, { passive: true });
    const check = () => setCanScroll(el.scrollHeight - el.clientHeight - el.scrollTop > 2);
    check();
    el.addEventListener('scroll', check, { passive: true });
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(check);
      observer.observe(el);
    }
    return () => {
      for (const name of MAP_GESTURE_EVENTS) el.removeEventListener(name, stop);
      el.removeEventListener('scroll', check);
      observer?.disconnect();
    };
  }, [open, maxMore, extract, loading]);

  // Keep the expanded bubble inside the strip. Measured after paint
  // (rAF) because the block has to be in the DOM at its final height
  // before it can be measured; re-run when the lead lands or the
  // ceiling changes, since those are the times the bubble grows.
  //
  // If the camera is still moving — the sniff's own ease onto the find
  // runs 600 ms, a walk stop's 450 ms, and a quick thumb taps "ще"
  // inside that — a measurement now is of a frame that will not be
  // there when it lands, and the pan computed from it is wrong by
  // however far the camera still had to go. That was the "sometimes it
  // doesn't snap": wait for moveend, then measure.
  //
  // The shift is chosen in BOTH directions, foot first: the foot must
  // clear the tab bar; the top clears the HUD if the bubble is short
  // enough for both — and with the ceiling above it always is, bar the
  // MORE_MIN_PX floor on a tiny screen, where the top is what gives.
  useEffect(() => {
    if (!open || !map || maxMore === null) return;
    let raf = 0;
    let cancelled = false;
    let passes = 0;
    const measure = () => {
      if (cancelled) return;
      const bubbleEl = toggleRef.current?.parentElement;
      const markerEl = toggleRef.current?.closest('.maplibregl-marker');
      if (!bubbleEl || !markerEl) return;
      const band = viewportBand();
      // The bubble is the top of the marker; the foot is the button
      // below it on a sniff, or the bubble itself on a walk stop.
      const footEl = markerEl.querySelector('[data-lore-foot]') ?? bubbleEl;
      const top = bubbleEl.getBoundingClientRect().top;
      const foot = footEl.getBoundingClientRect().bottom;
      // Shift the marker DOWN the screen by at least dMin (top clear of
      // the HUD) and at most dMax (foot clear of the tab bar). Negative
      // values move it up.
      const dMin = band.top - top;
      const dMax = band.bottom - foot;
      let d = 0;
      if (dMax < dMin) d = dMax; // taller than the strip: keep the foot
      else if (dMin > 0) d = dMin; // top hidden
      else if (dMax < 0) d = dMax; // foot hidden
      if (Math.abs(d) < MIN_PAN_PX) return;
      passes++;
      // Negative y moves the camera up, which moves the marker down.
      map.panBy([0, -d], { duration: PAN_MS });
      if (passes < MAX_PASSES) map.once('moveend', schedule);
    };
    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    if (map.isMoving()) map.once('moveend', schedule);
    else schedule();
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      map.off('moveend', schedule);
    };
  }, [open, maxMore, extract, loading, map]);

  // `loading` is deliberately NOT a dependency: setting it inside the
  // effect would re-run the effect, whose cleanup would then abandon the
  // very fetch it had just started. Closing the block mid-fetch drops the
  // result; reopening asks again, which Wikimedia's cache makes cheap.
  useEffect(() => {
    if (!open || !hasWiki || extract || failed) return;
    let live = true;
    setLoading(true);
    void fetchWikipediaExtract(lore.sourceLang!, lore.wikipediaTitle!).then((text) => {
      if (!live) return;
      if (text) setExtract(text);
      else setFailed(true);
      setLoading(false);
    });
    return () => {
      live = false;
      setLoading(false);
    };
  }, [open, hasWiki, extract, failed, lore.sourceLang, lore.wikipediaTitle]);

  const paper = tone === 'paper';
  const hairline = paper ? '1px solid rgba(0,0,0,0.12)' : '1px solid rgba(255,255,255,0.12)';
  const fadeTo = paper ? '#ffffff' : VOICE.background;
  // Nothing to show at all — neither our telling nor an article that
  // answered.
  const empty = !lore.detail && (!hasWiki || failed);

  return (
    <>
      {open ? (
        <div style={{ position: 'relative', marginTop: S.s, borderTop: hairline }}>
          <div
            ref={moreRef}
            style={{
              paddingTop: S.s,
              // Room under the last line so it clears the fade. Constant,
              // not toggled with the fade: a padding that came and went
              // as the fold was reached changed the box's height under
              // the finger.
              paddingBottom: S.s,
              // The ceiling includes the padding, so the box is exactly
              // the room it was given.
              boxSizing: 'border-box',
              maxHeight: maxMore ?? undefined,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
              fontSize: TYPE.small,
              lineHeight: 1.45,
              opacity: 0.85,
              textAlign: 'left',
              whiteSpace: 'pre-line',
              display: 'flex',
              flexDirection: 'column',
              gap: S.xs,
            }}
          >
            {lore.detail ? <div>{lore.detail}</div> : null}
            {hasWiki && loading ? (
              <div style={{ opacity: 0.6, fontStyle: 'italic' }}>{t.sniff.opening}</div>
            ) : null}
            {extract ? (
              <div style={lore.detail ? { opacity: 0.8, borderTop: hairline, paddingTop: S.xs } : undefined}>
                {clampExtract(extract)}
              </div>
            ) : null}
            {empty ? <div>{t.sniff.nothingMore}</div> : null}
            {hasWiki && !failed ? (
              <a
                href={wikipediaArticleUrl(lore.sourceLang!, lore.wikipediaTitle!)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  alignSelf: 'flex-start',
                  color: 'inherit',
                  fontSize: TYPE.caption,
                  fontWeight: 700,
                  textDecoration: 'underline',
                  textUnderlineOffset: 2,
                  opacity: 0.8,
                }}
              >
                {t.sniff.wikipedia}
              </a>
            ) : null}
          </div>
          {/* A fade over the last lines while there is more below —
              the sign that this scrolls, so a cut-off line never reads
              as a bug. Outside the scroll box so it stays put. */}
          {canScroll ? (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: S.xl,
                pointerEvents: 'none',
                background: `linear-gradient(to bottom, rgba(255,255,255,0), ${fadeTo})`,
              }}
            />
          ) : null}
        </div>
      ) : null}
      <div
        ref={toggleRef}
        role="button"
        onClick={(e) => {
          e.stopPropagation();
          playPop(e.currentTarget);
          setOpen((v) => !v);
        }}
        style={{
          marginTop: S.s,
          fontSize: TYPE.caption,
          fontWeight: 700,
          opacity: 0.7,
          textTransform: 'lowercase',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {open ? t.sniff.less : t.sniff.more}
      </div>
    </>
  );
}

// The heart. Sits in the top-right corner of the bubble (the bubble
// has to be position: relative), fills when the place is saved, and
// toggles the store optimistically. A glyph rather than an icon: the
// bubble's other affordances are glyphs too ("ще ▾", "ходімо сюди →"),
// and a heart in the app's ink reads as drawn on, like the frame.
//
// Room for it comes from the title's side padding — see HEART_INSET —
// so a long name wraps clear of it instead of underneath it.
export const HEART_INSET = 26;

export function LoreHeart({ lore, tone }: { lore: LoreRef; tone: Tone }) {
  const t = useStrings();
  const saved = useGameStore((s) => s.loreFavourites.some((f) => f.id === lore.id));
  const toggle = useGameStore((s) => s.toggleLoreFavourite);
  return (
    <div
      role="button"
      aria-label={saved ? t.sniff.saved : t.sniff.save}
      aria-pressed={saved}
      onClick={(e) => {
        e.stopPropagation();
        playPop(e.currentTarget);
        void toggle(lore);
      }}
      style={{
        position: 'absolute',
        top: 6,
        right: 8,
        // A ~40 px target around an 18 px glyph.
        padding: 8,
        fontSize: 18,
        lineHeight: 1,
        cursor: 'pointer',
        userSelect: 'none',
        color: 'inherit',
        opacity: saved ? 1 : tone === 'paper' ? 0.35 : 0.5,
      }}
    >
      {saved ? '♥' : '♡'}
    </div>
  );
}
