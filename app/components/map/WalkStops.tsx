import { useEffect, useMemo, useState } from 'react';
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
import { useMaplibreMap } from './MapContext';
import { ROUTE_DRAW_MS } from './CrayonRoute';
import { distanceMeters } from '../../utils/geo';

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
const STOP_DOT_MAP = 24;
const STOP_DOT_MAP_OPEN = 30;

// Invisible padding around the map dot, so the thing you have to hit to
// hear a story is a ~40 px target rather than a 16 px one. The marker is
// bottom-anchored, so the padding would lift the dot off its point —
// the marker offset below puts it back.
const STOP_DOT_HIT_PAD = 12;

// How far BELOW the map's centre the tapped stop is parked, in screen
// px. The bubble opens upward from the dot, so everything above the dot
// is the room it has; this leaves the HUD row and the walk pills clear
// at any zoom.
const STOP_OPEN_DROP_PX = 150;

const POP_KEYFRAMES = `
  @keyframes walk-stop-pop {
    0%   { transform: scale(0); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
  }
`;

export function WalkStops() {
  const map = useMaplibreMap();
  const stops = useGameStore((s) => s.walkStops);
  const route = useGameStore((s) => s.walkRoute);
  // Each stop pops when the drawing line reaches it. `alongM` is metres
  // from the start of the walk, so the delay is just that as a fraction
  // of the route's length, on the same clock CrayonRoute draws with.
  // Measured against the real path rather than staggered evenly by
  // index: stops are not evenly spaced, and an even stagger drifts
  // visibly out of step with the line on a walk with a long final leg.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('walk-stop-pop-style')) return;
    const el = document.createElement('style');
    el.id = 'walk-stop-pop-style';
    el.textContent = POP_KEYFRAMES;
    document.head.appendChild(el);
  }, []);
  const routeLenM = useMemo(() => {
    if (!route || route.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < route.length; i++) sum += distanceMeters(route[i - 1]!, route[i]!);
    return sum;
  }, [route]);
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
          popDelayMs={
            routeLenM > 0
              ? Math.min(ROUTE_DRAW_MS, (stop.alongM / routeLenM) * ROUTE_DRAW_MS)
              : 0
          }
          onToggle={() => {
            const opening = openId !== stop.id;
            setOpenWalkStop(opening ? stop.id : null);
            // Only on the way OPEN. Re-centring as a story closes would
            // yank the map for a tap that asked for nothing.
            if (opening && map) {
              map.easeTo({
                center: [stop.position.lng, stop.position.lat],
                offset: [0, STOP_OPEN_DROP_PX],
                duration: 450,
              });
            }
          }}
        />
      ))}
    </>
  );
}

function StopMarker({
  stop,
  open,
  popDelayMs,
  onToggle,
}: {
  stop: WalkStop;
  open: boolean;
  popDelayMs: number;
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
              // `both` fill so the dot is invisible through its delay
              // instead of sitting there and then jumping. The overshoot
              // curve is the one the radial menu and the HUD pills
              // already use, so a stop arriving reads as the same hand.
              animation: `walk-stop-pop 320ms cubic-bezier(0.34,1.56,0.64,1) ${Math.round(popDelayMs)}ms both`,
            }}
          />
        </div>
      </div>
    </MapLibreMarker>
  );
}

// The stops roster and the pill that opened it used to live here.
// Both are gone: the dots ARE the list now. A stop tells its own story
// where it stands on the route, which is the only place the story is
// about, and a second rendering of the same four names in a card was
// answering a question the map had already answered.
