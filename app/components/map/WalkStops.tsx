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
import { playPop } from '../../utils/popOnTap';
import { useStrings } from '../../i18n/useStrings';
import type { WalkStop } from '../../utils/walk';

// The landmarks a planned walk goes through, on the map.
//
// Each stop is a small numbered green disc sitting on the cyan dashed
// line — the pairing the product reference uses, and the reason a tour
// reads as a route WITH stops rather than as a line among some pins.
// Numbered because the order is the walk. Tap one and the dog says its
// sentence; tap "ще" inside that and the Wikipedia summary opens under
// it.
//
// ONE OPEN AT A TIME, held in the store rather than here: the walk-start
// list also opens stops (tapping a row flies the camera to it and expands
// it), so the two surfaces have to agree on which one is showing, and a
// piece of state two components drive belongs above both of them.

// Below this, a stop is on the way and saying anything about the detour
// is noise. Above it, the walker is being sent round a corner and should
// be told before they commit to the walk.
const NOTABLE_DETOUR_M = 80;

// The numbered disc, on the map and in the list. Dark numerals on the
// bright green rather than white: at this size white on #5fd726 is
// under the contrast a number has to clear to be read at a glance, and
// black-on-bright is the pairing the accent colour already uses
// elsewhere in the app.
const STOP_DISC_MAP = 26;
const STOP_DISC_MAP_OPEN = 30;
const STOP_DISC_CARD = 24;

export function WalkStops() {
  const stops = useGameStore((s) => s.walkStops);
  const openId = useGameStore((s) => s.openWalkStopId);
  const setOpenWalkStop = useGameStore((s) => s.setOpenWalkStop);

  if (stops.length === 0) return null;
  return (
    <>
      {stops.map((stop, i) => (
        <StopMarker
          key={stop.id}
          stop={stop}
          index={i + 1}
          open={openId === stop.id}
          onToggle={() => setOpenWalkStop(openId === stop.id ? null : stop.id)}
        />
      ))}
    </>
  );
}

function StopMarker({
  stop,
  index,
  open,
  onToggle,
}: {
  stop: WalkStop;
  index: number;
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
        {/* The disc itself. Numbered, because the order is the walk. */}
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
            width: open ? STOP_DISC_MAP_OPEN : STOP_DISC_MAP,
            height: open ? STOP_DISC_MAP_OPEN : STOP_DISC_MAP,
            borderRadius: R.pill,
            background: colors.walkStop,
            color: colors.black,
            border: `2px solid ${colors.white}`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
            fontFamily: SYSTEM_FONT,
            fontSize: TYPE.small,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {index}
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
  const approximate = useGameStore((s) => s.walkRouteMeta?.approximate === true);
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
        // House card shadow (CardStack) + the house hairline the modals
        // and spot cards use.
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        border: '1px solid rgba(0,0,0,0.06)',
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
      {stops.map((stop, i) => (
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
          <div
            style={{
              flex: '0 0 auto',
              width: STOP_DISC_CARD,
              height: STOP_DISC_CARD,
              borderRadius: R.pill,
              background: colors.walkStop,
              color: colors.black,
              fontSize: TYPE.small,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {i + 1}
          </div>
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
                // grows with four long stories covers the route it is
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
      {/* The line on the map is straight segments between the stops
          because street routing was unavailable. Said here rather than
          drawn: every walk's line is dashed, so the dashes cannot also
          mean "this one is a guess". */}
      {approximate ? (
        <div
          style={{
            marginTop: S.xs,
            fontSize: TYPE.caption,
            color: colors.grey,
            lineHeight: 1.4,
          }}
        >
          {t.walkStops.approximate}
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
