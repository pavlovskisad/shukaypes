import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMaplibreMap } from './MapContext';
import {
  clampExtract,
  fetchWikipediaExtract,
  wikipediaArticleUrl,
} from '../../services/wikipedia';
import type { LoreRef } from '../../services/api';
import { useGameStore } from '../../stores/gameStore';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { INK, SURFACE } from '../../constants/surface';
import { TYPE } from '../../constants/type';
import { VOICE } from '../../constants/voice';
import { Z } from '../../constants/z';
import { HandDrawnFrame } from '../ui/HandDrawn';
import { playPop } from '../../utils/popOnTap';
import { useStrings } from '../../i18n/useStrings';

// The "read more" under a landmark's one-line story, and the heart in
// the corner above it. One component for both places a kyiv_lore row is
// shown — the sniff-press bubble and a walk stop — so the two can't
// drift on what "more" means.
//
// "More" opens a SHEET, not a taller bubble. It used to grow the bubble
// in place and pan the map to fit it, and for a short detail that was
// fine; for a long one — four sentences, a Wikipedia lead, the walk
// button under it — the bubble was taller than the strip of screen
// between the HUD and the tab bar, and no pan can fit a thing taller
// than the window. The title went under the HUD or the button went
// under the tab bar, and which one depended on which edge the pan
// favoured. A map marker anchored to a point cannot hold that much
// text.
//
// So the bubble keeps what always fits — title, one-liner, heart, this
// toggle — and the sheet slides up from above the tab bar with the rest
// in it, scrolling inside itself. It is a fixed overlay on the page,
// not part of the marker, so a finger scrolling it never reaches the
// map. The old "nothing here scrolls" rule was about scroll boxes
// inside markers, and this is not one.
//
// What is in the sheet, in order:
//
//   1. The dog's own longer telling (kyiv_lore.detail), when the row has
//      one. Already on the phone, so it shows the instant the sheet
//      opens — no spinner, no network, no Wikipedia dependency.
//   2. The Wikipedia lead, when the row has an article. Fetched LAZILY
//      on the first open — most landmarks the walker glances at and
//      moves on from. Shown in full now that there is room to scroll;
//      the clamp to three lines existed only because the bubble could
//      not afford more.
//   3. A link to the article itself. The lead is CC-BY-SA text shown
//      as-is, and the link is its attribution; it is also where the
//      walker who wants the whole story goes.
//   4. The caller's foot, when it passes one: the sniff bubble's
//      "ходімо сюди", pinned under the text so it never scrolls away
//      and never sits under the tab bar.
//
// A row with neither telling nor article gets the same in-voice shrug
// the button always gave, so the affordance never reads as broken. The
// shrug is meant to be rare now: enrich-lore.ts exists to make it so.
//
// Owns its own open/fetched state. Callers reset it by remounting —
// `key={lore.id}` on a bubble that changes landmark, or unmounting the
// bubble when it closes — rather than by reaching in.

// The bubble still has to be seen above the sheet: while the sheet is
// open the map pans just enough to put the bubble between the HUD and
// the sheet's top edge. Both edges are MEASURED from the DOM: the HUD
// strip carries id="map-hud", the tab bar is the page's role="tablist".
// Two earlier cuts guessed them as constants and got it wrong both
// ways, because Safari's own bar changes where the container ends and
// a constant cannot know. The constants remain only as fallbacks for a
// DOM that has neither element.
//
// The gap kept on each side is the bubble's own rhythm: the same S.s
// that separates the bubble from its button.
const EDGE_GAP_PX = S.s;
const FALLBACK_TOP_PX = 140;
const FALLBACK_BOTTOM_PX = 200;
// Below this the pan is a twitch, not a fix.
const MIN_PAN_PX = 4;
const PAN_MS = 320;
// How many times one trigger may re-measure and pan again: the second
// pass catches a first pan measured against a frame that moved under
// it; a third would be chasing sub-pixel noise.
const MAX_PASSES = 2;

// The sheet never shrinks below this, whatever the bubble above it
// needs — on a very short viewport the bubble's top may go under the
// HUD, but the text stays readable and the button stays reachable.
const SHEET_MIN_PX = 180;
const SHEET_MAX_WIDTH = 460;
const SHEET_SIDE_PX = 10;
const SHEET_ANIM_MS = 260;

// The tab bar: the widest visible tablist on the page. There is one,
// but a hidden or zero-size one from another navigator must not win.
function tabBarRect(): DOMRect | null {
  let best: DOMRect | null = null;
  for (const el of Array.from(document.querySelectorAll('[role="tablist"]'))) {
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.width < 100) continue;
    if (!best || r.width > best.width) best = r;
  }
  return best;
}

// The strip of viewport between the HUD and the tab bar, in viewport
// px (what getBoundingClientRect and position: fixed both speak).
function viewportBand(): { top: number; bottom: number } {
  const hud = document.getElementById('map-hud')?.getBoundingClientRect();
  const tabs = tabBarRect();
  return {
    top: (hud ? hud.bottom : FALLBACK_TOP_PX) + EDGE_GAP_PX,
    bottom: (tabs ? tabs.top : window.innerHeight - FALLBACK_BOTTOM_PX) - EDGE_GAP_PX,
  };
}

export type LoreMoreSource = Pick<
  LoreRef,
  'name' | 'title' | 'detail' | 'wikipediaTitle' | 'sourceLang'
>;

type Tone = 'paper' | 'voice';

export function LoreMore({
  lore,
  tone,
  foot,
  onOpenChange,
}: {
  lore: LoreMoreSource;
  // The bubble this sits in: the sniff bubble is white paper, a walk
  // stop is the dog's dark voice. The sheet takes the same tone.
  tone: Tone;
  // Pinned under the sheet's text — the sniff bubble's walk button.
  foot?: ReactNode;
  // So the caller can take its own foot out of the bubble while the
  // sheet carries it.
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useStrings();
  const map = useMaplibreMap();
  // The toggle is always rendered, so it is the stable handle on the
  // bubble this block lives in.
  const toggleRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [extract, setExtract] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Where the sheet sits and how tall it may be, from the DOM.
  const [layout, setLayout] = useState<{ bottom: number; maxHeight: number } | null>(null);

  const hasWiki = !!lore.wikipediaTitle && !!lore.sourceLang;

  useEffect(() => {
    onOpenChange?.(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Size the sheet: it hangs EDGE_GAP above the tab bar and may take
  // the band minus the bubble that has to stay visible above it.
  // Before paint, so the first frame is already the right shape; again
  // on resize, since Safari's bar comes and goes.
  useLayoutEffect(() => {
    if (!open) {
      setLayout(null);
      return;
    }
    const compute = () => {
      const band = viewportBand();
      const bubbleH = toggleRef.current?.parentElement?.getBoundingClientRect().height ?? 0;
      const available = band.bottom - band.top;
      const maxHeight = Math.max(SHEET_MIN_PX, Math.min(available, available - bubbleH - EDGE_GAP_PX));
      setLayout({ bottom: window.innerHeight - band.bottom, maxHeight });
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [open]);

  // Keep the bubble in view above the sheet. Measured after paint
  // (rAF) because the sheet has to be in the DOM at its final height
  // before it can be measured; re-run whenever the sheet or the bubble
  // changes size — the lead landing is the usual reason — through a
  // ResizeObserver rather than a fixed list of triggers.
  //
  // If the camera is still moving — the sniff's own ease onto the find
  // runs 600 ms, a walk stop's 450 ms, and a quick thumb taps "ще"
  // inside that — a measurement now is of a frame that will not be
  // there when it lands, and the pan computed from it is wrong by
  // however far the camera still had to go. That was the "sometimes it
  // doesn't snap": wait for moveend, then measure.
  //
  // The shift is chosen in BOTH directions, foot first: the bubble's
  // bottom must clear the sheet; its top clears the HUD if the bubble
  // is short enough for both; when it is not, the top is what gives.
  useEffect(() => {
    if (!open || !map || !layout) return;
    let raf = 0;
    let cancelled = false;
    let passes = 0;
    const measure = () => {
      if (cancelled) return;
      const bubbleEl = toggleRef.current?.parentElement;
      const sheetEl = sheetRef.current;
      if (!bubbleEl || !sheetEl) return;
      const band = viewportBand();
      const bubble = bubbleEl.getBoundingClientRect();
      const sheetTop = sheetEl.getBoundingClientRect().top - EDGE_GAP_PX;
      // Shift the bubble DOWN the screen by at least dMin (top clear of
      // the HUD) and at most dMax (bottom clear of the sheet). Negative
      // values move it up.
      const dMin = band.top - bubble.top;
      const dMax = sheetTop - bubble.bottom;
      let d = 0;
      if (dMax < dMin) d = dMax; // taller than the room: keep the foot
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
    const trigger = () => {
      passes = 0;
      if (map.isMoving()) map.once('moveend', schedule);
      else schedule();
    };
    trigger();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(trigger);
      if (sheetRef.current) observer.observe(sheetRef.current);
      const bubbleEl = toggleRef.current?.parentElement;
      if (bubbleEl) observer.observe(bubbleEl);
    }
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      map.off('moveend', schedule);
      observer?.disconnect();
    };
  }, [open, layout, map]);

  // `loading` is deliberately NOT a dependency: setting it inside the
  // effect would re-run the effect, whose cleanup would then abandon the
  // very fetch it had just started. Closing the sheet mid-fetch drops the
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

  // Nothing to show at all — neither our telling nor an article that
  // answered.
  const empty = !lore.detail && (!hasWiki || failed);
  const paper = tone === 'paper';
  const hairline = paper ? '1px solid rgba(0,0,0,0.12)' : '1px solid rgba(255,255,255,0.12)';

  const sheet =
    open && layout && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={sheetRef}
            role="dialog"
            aria-label={lore.title ?? lore.name}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              left: SHEET_SIDE_PX,
              right: SHEET_SIDE_PX,
              bottom: layout.bottom,
              margin: '0 auto',
              maxWidth: SHEET_MAX_WIDTH,
              maxHeight: layout.maxHeight,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              borderRadius: R.card,
              background: paper ? SURFACE.fill : VOICE.background,
              color: paper ? INK : VOICE.color,
              border: paper ? undefined : VOICE.border,
              boxShadow: SURFACE.lift,
              fontFamily: VOICE.fontFamily,
              fontSize: TYPE.small,
              lineHeight: 1.45,
              zIndex: Z.MODAL_MAP,
              animation: `lore-sheet-in ${SHEET_ANIM_MS}ms cubic-bezier(0.4,0,0.2,1)`,
            }}
          >
            {paper ? <HandDrawnFrame radius={R.card} /> : null}
            {/* Title on the left, the close cross on the right. The
                bubble above still shows the name, but the sheet can
                cover it on a short screen, and a sheet with no title
                is a wall of text with no owner. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: S.s,
                padding: `${S.m}px ${S.m}px 0 ${S.l}px`,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  flexGrow: 1,
                  fontSize: TYPE.body,
                  fontWeight: 700,
                  lineHeight: 1.3,
                  paddingTop: 6,
                }}
              >
                {lore.title ?? lore.name}
              </div>
              <div
                role="button"
                aria-label={t.modals.common.close}
                onClick={(e) => {
                  e.stopPropagation();
                  playPop(e.currentTarget);
                  setOpen(false);
                }}
                style={{
                  width: 36,
                  height: 36,
                  flexShrink: 0,
                  borderRadius: R.pill,
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  userSelect: 'none',
                  fontSize: TYPE.display,
                  lineHeight: 1,
                  background: paper ? SURFACE.fill : 'rgba(255,255,255,0.1)',
                  boxShadow: paper ? SURFACE.chip : undefined,
                }}
              >
                {paper ? <HandDrawnFrame radius={R.pill} /> : null}
                ×
              </div>
            </div>
            {/* The text. Scrolls inside the sheet; the page and the map
                under it never move with it. */}
            <div
              style={{
                flexGrow: 1,
                minHeight: 0,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                overscrollBehavior: 'contain',
                padding: `${S.s}px ${S.l}px ${S.m}px`,
                opacity: 0.9,
                textAlign: 'left',
                whiteSpace: 'pre-line',
                display: 'flex',
                flexDirection: 'column',
                gap: S.s,
              }}
            >
              {lore.detail ? <div>{lore.detail}</div> : null}
              {hasWiki && loading ? (
                <div style={{ opacity: 0.6, fontStyle: 'italic' }}>{t.sniff.opening}</div>
              ) : null}
              {extract ? (
                <div style={lore.detail ? { opacity: 0.8, borderTop: hairline, paddingTop: S.s } : undefined}>
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
            {foot ? (
              <div
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  justifyContent: 'center',
                  padding: `${S.s}px ${S.l}px ${S.m}px`,
                  borderTop: hairline,
                }}
              >
                {foot}
              </div>
            ) : null}
            <style>{`
              @keyframes lore-sheet-in {
                from { transform: translateY(calc(100% + 24px)); }
                to { transform: translateY(0); }
              }
            `}</style>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {sheet}
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
