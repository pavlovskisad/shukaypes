import { useEffect, useState } from 'react';
import type { LatLng } from '@shukajpes/shared';
import { MapLibreMarker } from './MapLibreMarker';
import { useGameStore } from '../../stores/gameStore';
import { clampExtract, fetchWikipediaExtract } from '../../services/wikipedia';
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
// Each stop is a small numbered disc sitting on the route, in the same
// blue the route is drawn in so it reads as part of the line rather than
// as one more POI. Tap one and the dog says its sentence; tap "ще" inside
// that and the Wikipedia summary opens underneath.
//
// ONE OPEN AT A TIME, held in the store rather than here: the walk-start
// list also opens stops (tapping a row flies the camera to it and expands
// it), so the two surfaces have to agree on which one is showing, and a
// piece of state two components drive belongs above both of them.

// Same blue as the walk polyline in MapView.
const WALK_COLOR = '#2f6bff';

// Below this, a stop is on the way and saying anything about the detour
// is noise. Above it, the walker is being sent round a corner and should
// be told before they commit to the walk.
const NOTABLE_DETOUR_M = 80;

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
            width: open ? 30 : 26,
            height: open ? 30 : 26,
            borderRadius: R.pill,
            background: WALK_COLOR,
            color: '#ffffff',
            border: '2px solid #ffffff',
            boxShadow: '0 2px 8px rgba(47,107,255,0.4)',
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

// The list of stops, shown once when a walk starts: what this walk is,
// before the walker has taken a step. Rows fly the camera to a stop and
// open its story, which is also the discovery path for the numbered
// discs — somebody who dismisses this card has already been told the
// numbers mean something.
//
// The camera move comes in as a prop rather than off MapContext: this
// card lives in MapView's HUD stack, outside the map's own provider,
// alongside the cancel-walk pill it sits above.
export function WalkStopsIntro({
  onFocusStop,
}: {
  onFocusStop: (position: LatLng) => void;
}) {
  const t = useStrings();
  const stops = useGameStore((s) => s.walkStops);
  const walkRoute = useGameStore((s) => s.walkRoute);
  const destinationName = useGameStore((s) => s.walkRouteMeta?.destinationName);
  const seen = useGameStore((s) => s.walkStopsIntroSeen);
  const dismiss = useGameStore((s) => s.dismissWalkStopsIntro);
  const setOpenWalkStop = useGameStore((s) => s.setOpenWalkStop);

  if (!walkRoute || seen || stops.length === 0) return null;

  const focus = (position: LatLng, id: string) => {
    setOpenWalkStop(id);
    dismiss();
    onFocusStop(position);
  };

  return (
    <div
      style={{
        pointerEvents: 'auto',
        maxWidth: 320,
        width: '86%',
        padding: `${S.m}px ${S.l}px`,
        background: '#ffffff',
        color: '#1a1a1a',
        borderRadius: R.card,
        fontFamily: SYSTEM_FONT,
        boxShadow: '0 6px 18px rgba(0,0,0,0.14)',
        border: '1px solid rgba(0,0,0,0.06)',
      }}
    >
      <div
        style={{
          fontSize: TYPE.small,
          fontWeight: 700,
          textTransform: 'lowercase',
          marginBottom: S.s,
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
            gap: S.s,
            padding: `${S.xs}px 0`,
          }}
        >
          <div
            style={{
              flex: '0 0 auto',
              width: 20,
              height: 20,
              borderRadius: R.pill,
              background: WALK_COLOR,
              color: '#ffffff',
              fontSize: TYPE.caption,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {i + 1}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: TYPE.small, fontWeight: 600 }}>
              {stop.name}
              {stop.offRouteM >= NOTABLE_DETOUR_M ? (
                <span style={{ fontWeight: 400, opacity: 0.45 }}>
                  {' · '}
                  {t.walkStops.offRoute(stop.offRouteM)}
                </span>
              ) : null}
            </div>
            <div
              style={{
                fontSize: TYPE.caption,
                opacity: 0.55,
                lineHeight: 1.35,
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
            marginTop: S.xs,
            paddingTop: S.xs,
            borderTop: '1px solid rgba(0,0,0,0.06)',
            fontSize: TYPE.caption,
            opacity: 0.55,
          }}
        >
          {t.walkStops.destination(destinationName)}
        </div>
      ) : null}
      <div
        role="button"
        onClick={(e) => {
          playPop(e.currentTarget);
          dismiss();
        }}
        style={{
          marginTop: S.s,
          textAlign: 'center',
          cursor: 'pointer',
          userSelect: 'none',
          fontSize: TYPE.caption,
          fontWeight: 700,
          textTransform: 'lowercase',
          opacity: 0.6,
        }}
      >
        {t.walkStops.dismiss}
      </div>
    </div>
  );
}
