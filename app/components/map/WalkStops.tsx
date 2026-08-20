import { useEffect, useState } from 'react';
import type { LatLng } from '@shukajpes/shared';
import { MapLibreMarker } from './MapLibreMarker';
import { useGameStore } from '../../stores/gameStore';
import { clampExtract, fetchWikipediaExtract } from '../../services/wikipedia';
import { HUD_OVERLAY_PILL, MODAL_PILL_DARK } from '../../constants/buttons';
import { colors } from '../../constants/colors';
import { SYSTEM_FONT } from '../../constants/fonts';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { Z } from '../../constants/z';
import { VOICE } from '../../constants/voice';
import { SURFACE } from '../../constants/surface';
import { playPop } from '../../utils/popOnTap';
import { useStrings } from '../../i18n/useStrings';
import type { WalkStop } from '../../utils/walk';

// The landmarks a planned walk goes through, on the map.
//
// Each stop is a plain green dot sitting on the cyan dashed line — the
// pairing the product reference uses, and the reason a tour reads as a
// route WITH stops rather than as a line among some pins. Tap one and
// the dog says its sentence; tap "ще" inside that and the Wikipedia
// summary opens under it.
//
// ONE OPEN AT A TIME, held in the store rather than here: the walk-start
// list also opens stops (tapping a row flies the camera to it and expands
// it), so the two surfaces have to agree on which one is showing, and a
// piece of state two components drive belongs above both of them.

// Below this, a stop is on the way and saying anything about the detour
// is noise. Above it, the walker is being sent round a corner and should
// be told before they commit to the walk.
const NOTABLE_DETOUR_M = 80;

// Plain green dots, unnumbered and unbordered — the reference again.
//
// They carried numbers at first, on the reasoning that the order is the
// walk. It isn't: these are four places near your route, and which one
// you reach first depends on which way you actually turn. Numbering
// them promised a sequence the walk doesn't enforce, and a bare dot
// promises nothing but "something here".
//
// The map dot grows a little while its story is open, which is the only
// state it has.
const STOP_DOT_MAP = 16;
const STOP_DOT_MAP_OPEN = 22;
const STOP_DOT_CARD = 10;

// Invisible padding around the map dot, so the thing you have to hit to
// hear a story is a ~40 px target rather than a 16 px one. The marker is
// bottom-anchored, so the padding would lift the dot off its point —
// the marker offset below puts it back.
const STOP_DOT_HIT_PAD = 12;

export function WalkStops() {
  const stops = useGameStore((s) => s.walkStops);
  const openId = useGameStore((s) => s.openWalkStopId);
  const setOpenWalkStop = useGameStore((s) => s.setOpenWalkStop);

  if (stops.length === 0) return null;
  return (
    <>
      {stops.map((stop) => (
        <StopMarker
          key={stop.id}
          stop={stop}
          open={openId === stop.id}
          onToggle={() => setOpenWalkStop(openId === stop.id ? null : stop.id)}
        />
      ))}
    </>
  );
}

function StopMarker({
  stop,
  open,
  onToggle,
}: {
  stop: WalkStop;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useStrings();
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreText, setMoreText] = useState<string | null>(null);

  // Collapsing the stop collapses its article too — reopening a stop
  // should show the dog's sentence first, not the wall of text somebody
  // left expanded three stops ago. The fetched text is kept so a second
  // expand is instant.
  useEffect(() => {
    if (!open) setMoreOpen(false);
  }, [open]);

  const expandMore = async () => {
    if (moreLoading) return;
    if (moreOpen) {
      setMoreOpen(false);
      return;
    }
    if (moreText) {
      setMoreOpen(true);
      return;
    }
    // No article — still open, with the same in-voice shrug the sniff
    // bubble gives, so the affordance doesn't read as broken.
    if (!stop.wikipediaTitle || !stop.sourceLang) {
      setMoreText('*чухає за вухом* більше не пригадую — тільки те, що сказав.');
      setMoreOpen(true);
      return;
    }
    setMoreLoading(true);
    const text = await fetchWikipediaExtract(stop.sourceLang, stop.wikipediaTitle);
    setMoreText(
      text ?? '*чухає за вухом* більше не пригадую — тільки те, що сказав.',
    );
    setMoreOpen(true);
    setMoreLoading(false);
  };

  return (
    <MapLibreMarker
      position={stop.position}
      anchor="bottom"
      // An open stop's bubble has to clear the other stops' discs and
      // the POI field around it; a closed disc belongs down with the
      // route it marks.
      zIndex={open ? Z.HUD_SNIFF_BUBBLE : Z.MARKER_WALK_STOP}
      // Cancels the hit-area padding under the dot — see
      // STOP_DOT_HIT_PAD.
      offset={[0, STOP_DOT_HIT_PAD]}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: S.xs,
          maxWidth: 260,
        }}
      >
        {open ? (
          <div
            style={{
              padding: '12px 14px',
              background: VOICE.background,
              color: VOICE.color,
              borderRadius: R.chip,
              fontFamily: VOICE.fontFamily,
              fontSize: TYPE.body,
              lineHeight: 1.4,
              boxShadow: VOICE.shadow,
              border: VOICE.border,
              textAlign: 'center',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 2 }}>{stop.name}</div>
            <div>{stop.story}</div>
            {moreOpen && moreText ? (
              <div
                style={{
                  marginTop: S.s,
                  paddingTop: S.s,
                  borderTop: '1px solid rgba(255,255,255,0.12)',
                  fontSize: TYPE.small,
                  lineHeight: 1.45,
                  opacity: 0.85,
                  textAlign: 'left',
                  maxHeight: 180,
                  overflowY: 'auto',
                  whiteSpace: 'pre-line',
                }}
              >
                {clampExtract(moreText)}
              </div>
            ) : null}
            <div
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                playPop(e.currentTarget);
                void expandMore();
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
              {moreLoading ? t.sniff.opening : moreOpen ? t.sniff.less : t.sniff.more}
            </div>
          </div>
        ) : null}
        {/* The dot itself. Bare green, no ring and no number, inside a
            transparent pad that does the catching. */}
        <div
          role="button"
          aria-label={stop.name}
          onClick={(e) => {
            e.stopPropagation();
            playPop(e.currentTarget);
            onToggle();
          }}
          style={{
            cursor: 'pointer',
            userSelect: 'none',
            padding: STOP_DOT_HIT_PAD,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: open ? STOP_DOT_MAP_OPEN : STOP_DOT_MAP,
              height: open ? STOP_DOT_MAP_OPEN : STOP_DOT_MAP,
              borderRadius: R.pill,
              background: colors.walkStop,
              boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
            }}
          />
        </div>
      </div>
    </MapLibreMarker>
  );
}

// The pill that opens the list back up, for the HUD's overlay row next
// to "cancel walk". Closing the card must not be a one-way door: the
// stops are the walk, and once they were behind a dismissed card the
// only way back to them was to plan a different walk.
export function WalkStopsToggle() {
  const t = useStrings();
  const stops = useGameStore((s) => s.walkStops);
  const open = useGameStore((s) => s.walkStopsOpen);
  const setOpen = useGameStore((s) => s.setWalkStopsOpen);
  if (stops.length === 0) return null;
  return (
    <div
      role="button"
      aria-label={t.walkStops.heading(stops.length)}
      aria-expanded={open}
      onClick={(e) => {
        playPop(e.currentTarget);
        setOpen(!open);
      }}
      style={{ ...HUD_OVERLAY_PILL, opacity: open ? 0.7 : 1 }}
    >
      {t.walkStops.count(stops.length)}
    </div>
  );
}

// What this walk has to show. Opens itself when the walk starts, and is
// reopened from the pill above.
//
// Rows fly the camera to a stop and close the card, because the card
// sits over the middle of the map and would cover the very thing it was
// just asked to show. Closing it is not losing it — the pill brings it
// back, and the walk itself is untouched either way. NOTHING here
// cancels the route; that is the cancel pill's single job.
//
// The camera move comes in as a prop rather than off MapContext: this
// card lives in MapView's HUD stack, outside the map's own provider.
export function WalkStopsCard({
  onFocusStop,
}: {
  onFocusStop: (position: LatLng) => void;
}) {
  const t = useStrings();
  const stops = useGameStore((s) => s.walkStops);
  const walkRoute = useGameStore((s) => s.walkRoute);
  const destinationName = useGameStore((s) => s.walkRouteMeta?.destinationName);
  const open = useGameStore((s) => s.walkStopsOpen);
  const setOpen = useGameStore((s) => s.setWalkStopsOpen);
  const setOpenWalkStop = useGameStore((s) => s.setOpenWalkStop);

  if (!walkRoute || !open || stops.length === 0) return null;

  const focus = (position: LatLng, id: string) => {
    setOpenWalkStop(id);
    setOpen(false);
    onFocusStop(position);
  };

  return (
    <div
      style={{
        pointerEvents: 'auto',
        maxWidth: 340,
        width: '88%',
        padding: `${S.l}px ${S.l}px ${S.m}px`,
        background: colors.white,
        color: colors.black,
        borderRadius: R.card,
        fontFamily: SYSTEM_FONT,
        // Belt and braces on top of the three-stop cap: a phone in
        // landscape, or a run of very long names, still cannot push the
        // CTA off the bottom of the screen.
        maxHeight: '62vh',
        overflowY: 'auto',
        // House card shadow (CardStack) + the house hairline the modals
        // and spot cards use.
        boxShadow: SURFACE.chip,
        border: SURFACE.hair,
      }}
    >
      <div
        style={{
          fontSize: TYPE.title,
          fontWeight: 700,
          marginBottom: S.m,
        }}
      >
        {t.walkStops.heading(stops.length)}
      </div>
      {stops.map((stop) => (
        <div
          key={stop.id}
          role="button"
          onClick={(e) => {
            playPop(e.currentTarget);
            focus(stop.position, stop.id);
          }}
          style={{
            cursor: 'pointer',
            userSelect: 'none',
            display: 'flex',
            alignItems: 'flex-start',
            gap: S.m,
            padding: `${S.s}px 0`,
          }}
        >
          {/* Bullet, matching the dots on the map. Nudged down to sit
              on the name's optical centre rather than its box top. */}
          <div
            style={{
              flex: '0 0 auto',
              width: STOP_DOT_CARD,
              height: STOP_DOT_CARD,
              marginTop: 6,
              borderRadius: R.pill,
              background: colors.walkStop,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: TYPE.body, fontWeight: 700 }}>
              {stop.name}
              {stop.offRouteM >= NOTABLE_DETOUR_M ? (
                <span style={{ fontWeight: 400, color: colors.grey }}>
                  {' · '}
                  {t.walkStops.offRoute(stop.offRouteM)}
                </span>
              ) : null}
            </div>
            <div
              style={{
                fontSize: TYPE.small,
                color: colors.grey,
                lineHeight: 1.4,
                marginTop: 2,
                // Two lines of the story is a taste of it — the whole
                // sentence is one tap away on the map, and a card that
                // grows with three long stories covers the route it is
                // describing.
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {stop.story}
            </div>
          </div>
        </div>
      ))}
      {destinationName ? (
        <div
          style={{
            marginTop: S.s,
            paddingTop: S.s,
            borderTop: '1px solid rgba(0,0,0,0.06)',
            fontSize: TYPE.small,
            color: colors.grey,
          }}
        >
          {t.walkStops.destination(destinationName)}
        </div>
      ) : null}
      {/* House CTA pill, same recipe as every modal's primary action. */}
      <div style={{ display: 'flex', marginTop: S.m }}>
        <button
          onClick={(e) => {
            playPop(e.currentTarget);
            setOpen(false);
          }}
          style={{ ...MODAL_PILL_DARK, appearance: 'none' }}
        >
          {t.walkStops.dismiss}
        </button>
      </div>
    </div>
  );
}
