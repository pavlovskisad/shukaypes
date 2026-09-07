import { useEffect, useRef, useState } from 'react';
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
//      moves on from. Shown in full when it is all there is; clamped to
//      a few lines under a detail, where it is a second opinion rather
//      than the story, and the link below it is the way to the rest.
//      Nothing here scrolls: a scroll box inside a map marker fights
//      the map for the finger and reads as text cut off for no reason.
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

// The bubble is bottom-anchored on its marker, so "more" grows UPWARD —
// and on a phone the two-to-four sentences plus the Wikipedia lead grow
// straight under the HUD row, with the top of the text clipped behind
// the mode buttons. When the block opens (and again when the lead
// arrives and the block gets taller) the map pans just far enough to
// bring the bubble's top edge below the HUD, without pushing the
// bubble's foot — the "ходімо сюди" button on a sniff, the bubble
// itself on a walk stop — into the tab bar.
//
// Both edges are MEASURED from the DOM: the HUD strip carries
// id="map-hud", the tab bar is the page's role="tablist". Two earlier
// cuts guessed them as constants (120 then 200 px from the container's
// bottom) and got it wrong both ways — first the button sat on the tab
// bar, then the bubble stopped short of the HUD with air to spare
// below, because Safari's own bar changes where the container ends and
// the constant could not know. The constants remain only as fallbacks
// for a DOM that has neither element.
//
// The gap kept on each side is the bubble's own rhythm: the same S.s
// that separates the bubble from its button.
const EDGE_GAP_PX = S.s;
const FALLBACK_TOP_PX = 140;
const FALLBACK_BOTTOM_PX = 200;
// Below this the pan is a twitch, not a fix.
const MIN_PAN_PX = 4;
const PAN_MS = 320;

// Where the bubble may sit, in CSS px from the top of the map container.
function screenBand(container: DOMRect): { top: number; bottom: number } {
  const hud = document.getElementById('map-hud')?.getBoundingClientRect();
  const tabs = document.querySelector('[role="tablist"]')?.getBoundingClientRect();
  return {
    top: (hud ? hud.bottom - container.top : FALLBACK_TOP_PX) + EDGE_GAP_PX,
    bottom: (tabs ? tabs.top - container.top : container.height - FALLBACK_BOTTOM_PX) - EDGE_GAP_PX,
  };
}

// How much of the Wikipedia lead shows under a detail. Three lines is
// enough to see it agrees with the dog and to want the link.
const EXTRACT_LINES_UNDER_DETAIL = 3;

export type LoreMoreSource = Pick<LoreRef, 'detail' | 'wikipediaTitle' | 'sourceLang'>;

type Tone = 'paper' | 'voice';

export function LoreMore({
  lore,
  tone,
}: {
  lore: LoreMoreSource;
  // The bubble this sits in: the sniff bubble is white paper, a walk
  // stop is the dog's dark voice. Only the hairline between story and
  // more changes.
  tone: Tone;
}) {
  const t = useStrings();
  const map = useMaplibreMap();
  // The toggle is always rendered, so it is the stable handle on the
  // marker this block lives in.
  const toggleRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [extract, setExtract] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const hasWiki = !!lore.wikipediaTitle && !!lore.sourceLang;

  // Keep the expanded bubble inside the viewport. Measured after paint
  // (rAF) because the block has to be in the DOM at its final height
  // before it can be measured; re-run when the lead lands, since that
  // is the second time the bubble grows. Only ever pans DOWN the screen
  // and only on open — closing yanks nothing.
  //
  // If the camera is still moving — the sniff's own ease onto the find
  // runs 600 ms, a walk stop's 450 ms, and a quick thumb taps "ще"
  // inside that — a measurement now is of a frame that will not be
  // there when it lands, and the pan computed from it is wrong by
  // however far the camera still had to go. That was the "sometimes it
  // doesn't snap": wait for moveend, then measure.
  useEffect(() => {
    if (!open || !map) return;
    let raf = 0;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const bubbleEl = toggleRef.current?.parentElement;
      const markerEl = toggleRef.current?.closest('.maplibregl-marker');
      if (!bubbleEl || !markerEl) return;
      const container = map.getContainer().getBoundingClientRect();
      const band = screenBand(container);
      // The bubble is the top of the marker; the foot is the button
      // below it on a sniff, or the bubble itself on a walk stop.
      const footEl = markerEl.querySelector('[data-lore-foot]') ?? bubbleEl;
      const top = bubbleEl.getBoundingClientRect().top - container.top;
      const foot = footEl.getBoundingClientRect().bottom - container.top;
      const need = band.top - top;
      if (need < MIN_PAN_PX) return;
      // Room below before the foot would reach the tab bar. A bubble
      // taller than the band keeps its foot on screen; the top is what
      // gives.
      const room = band.bottom - foot;
      const delta = Math.min(need, Math.max(0, room));
      if (delta < MIN_PAN_PX) return;
      // Negative y moves the camera up, which moves the marker down.
      map.panBy([0, -delta], { duration: PAN_MS });
    };
    const schedule = () => {
      raf = requestAnimationFrame(measure);
    };
    if (map.isMoving()) map.once('moveend', schedule);
    else schedule();
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      map.off('moveend', schedule);
    };
  }, [open, extract, loading, map]);

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

  const hairline =
    tone === 'paper' ? '1px solid rgba(0,0,0,0.12)' : '1px solid rgba(255,255,255,0.12)';
  // Nothing to show at all — neither our telling nor an article that
  // answered.
  const empty = !lore.detail && (!hasWiki || failed);

  return (
    <>
      {open ? (
        <div
          style={{
            marginTop: S.s,
            paddingTop: S.s,
            borderTop: hairline,
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
            <div
              style={
                lore.detail
                  ? {
                      opacity: 0.8,
                      // Clamped, not scrolled — see the header. The
                      // link right under it is the rest.
                      display: '-webkit-box',
                      WebkitBoxOrient: 'vertical',
                      WebkitLineClamp: EXTRACT_LINES_UNDER_DETAIL,
                      overflow: 'hidden',
                    }
                  : undefined
              }
            >
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
