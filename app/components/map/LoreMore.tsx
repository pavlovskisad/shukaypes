import { useEffect, useRef, useState } from 'react';
import { useMaplibreMap } from './MapContext';
import {
  clampExtract,
  fetchWikipediaExtract,
  wikipediaArticleUrl,
} from '../../services/wikipedia';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { playPop } from '../../utils/popOnTap';
import { useStrings } from '../../i18n/useStrings';

// The "read more" under a landmark's one-line story. One component for
// both places a kyiv_lore row is shown — the sniff-press bubble and a
// walk stop — so the two can't drift on what "more" means.
//
// What's behind the button, in the order it appears:
//
//   1. The dog's own longer telling (kyiv_lore.detail), when the row has
//      one. Already on the phone, so it shows the instant the button is
//      tapped — no spinner, no network, no Wikipedia dependency.
//   2. The Wikipedia lead, when the row has an article. Fetched LAZILY
//      on the first expand — most landmarks the walker glances at and
//      moves on from — and shown under the detail as it arrives.
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
// bring the marker's top edge below the HUD, without pushing the dot at
// the bottom under the tab bar.
//
// Screen bands, in CSS px from the map container's edges. The HUD row
// (logo + mode toggles + paw count) ends ~125 px down on an iPhone in
// Safari; the tab bar plus its safe-area inset take ~110 px at the
// bottom. Both carry a margin so the bubble's drawn edge clears them.
const SAFE_TOP_PX = 140;
const SAFE_BOTTOM_PX = 120;
// Below this the pan is a twitch, not a fix.
const MIN_PAN_PX = 4;
const PAN_MS = 320;

export interface LoreMoreSource {
  detail: string | null;
  wikipediaTitle: string | null;
  sourceLang: string | null;
}

export function LoreMore({
  lore,
  tone,
}: {
  lore: LoreMoreSource;
  // The bubble this sits in: the sniff bubble is white paper, a walk
  // stop is the dog's dark voice. Only the hairline between story and
  // more changes.
  tone: 'paper' | 'voice';
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
  useEffect(() => {
    if (!open || !map) return;
    const raf = requestAnimationFrame(() => {
      const markerEl = toggleRef.current?.closest('.maplibregl-marker');
      if (!markerEl) return;
      const container = map.getContainer().getBoundingClientRect();
      const rect = markerEl.getBoundingClientRect();
      const top = rect.top - container.top;
      const bottom = rect.bottom - container.top;
      const need = SAFE_TOP_PX - top;
      if (need < MIN_PAN_PX) return;
      // Room below before the dot would slide under the tab bar. A
      // bubble taller than the band between HUD and tab bar keeps its
      // bottom on screen and scrolls inside instead.
      const room = container.height - SAFE_BOTTOM_PX - bottom;
      const delta = Math.min(need, Math.max(0, room));
      if (delta < MIN_PAN_PX) return;
      // Negative y moves the camera up, which moves the marker down.
      map.panBy([0, -delta], { duration: PAN_MS });
    });
    return () => cancelAnimationFrame(raf);
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
            maxHeight: 200,
            overflowY: 'auto',
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
            <div style={{ opacity: lore.detail ? 0.8 : 1 }}>{clampExtract(extract)}</div>
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
