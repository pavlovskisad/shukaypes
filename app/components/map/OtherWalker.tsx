import { useEffect, useRef, useState } from 'react';
import type { NearbyPlayer } from '@shukajpes/shared';
import { MapLibreMarker } from './MapLibreMarker';
import { useMaplibreMap } from './MapContext';
import { DogSprite } from './DogSprite';
import { Z } from '../../constants/z';
import { ownerColorCss } from './territoryColor';
import { SYSTEM_FONT } from '../../constants/fonts';
import { useGameStore } from '../../stores/gameStore';
import { haptic } from '../../utils/haptics';
import { R } from '../../constants/radius';
import { INK, SURFACE } from '../../constants/surface';

// One other player's dog on the map (real player or bot). Presence updates
// arrive every ~15s (real) / ~3.5s (bots), so we GLIDE the dog toward its
// latest reported position instead of teleporting — it reads as another
// person out walking. Kept deliberately lighter than the user's own
// Companion: no radial menu, smaller sprite, just a name tag.
//
// Bots and real players render identically on purpose — that's what makes the
// simulated density a faithful preview of the real UX.

interface Props {
  player: NearbyPlayer;
}

// Metres-per-degree helpers for the small movement/facing deltas.
const M_PER_LAT = 110540;

export function OtherWalker({ player }: Props) {
  // The current LEG: where this dog was when the last position arrived,
  // where it is headed, when it set off, and how long it should take.
  //
  // Walked at a steady pace across the whole gap between updates, rather
  // than eased toward the target. Exponential easing covers 90% of the
  // distance in a fraction of the interval and then stops dead, so once
  // presence settled at its intended 15s the dog spent about two seconds
  // walking and thirteen sitting — which is what "all the dogs just sat"
  // actually looked like. Pacing the leg over the observed gap keeps it
  // walking right up to the moment the next position lands.
  const legRef = useRef({
    from: { ...player.position },
    to: { ...player.position },
    startAt: 0,
    durMs: 0,
  });
  // When the previous target arrived, so the next leg can be paced over
  // however long the gap actually turns out to be. Measured rather than
  // assumed: bots and real players report at different rates, and the
  // sync cadence itself changes with how fast the user is moving.
  const lastTargetAtRef = useRef(0);

  const posRef = useRef({ ...player.position });
  const [pos, setPos] = useState({ ...player.position });
  const [facingLeft, setFacingLeft] = useState(false);
  const [moving, setMoving] = useState(false);
  // Mirrored into a ref because the glide loop below is created once with
  // []-deps: read straight from the state variable and it sees whatever
  // `moving` was on the first render forever, so the branch that puts the
  // dog back down never runs.
  const movingRef = useRef(false);
  // Brief "👋" confirmation after you poke this walker.
  const [poked, setPoked] = useState(false);
  const pokePlayer = useGameStore((s) => s.pokePlayer);
  const territoryVisible = useGameStore((s) => s.territoryVisible);
  // Kept in a ref so the []-deps glide interval always reads the current map
  // without re-creating. Used for screen-space facing (rotation-proof).
  const map = useMaplibreMap();
  const mapRef = useRef(map);
  mapRef.current = map;

  // A new reported position starts a new leg from wherever the dog has
  // actually got to, paced over however long the last gap was.
  useEffect(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const prevAt = lastTargetAtRef.current;
    lastTargetAtRef.current = now;
    // First update has no gap to measure. Clamped at both ends: a burst of
    // updates shouldn't make the dog sprint, and a long stall shouldn't
    // leave it creeping across the map for a minute.
    const gap = prevAt ? now - prevAt : 0;
    const durMs = gap > 0 ? Math.min(20_000, Math.max(1_500, gap)) : 2_000;
    legRef.current = {
      from: { ...posRef.current },
      to: { ...player.position },
      startAt: now,
      durMs,
    };
  }, [player.position.lat, player.position.lng]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const leg = legRef.current;
      const cosLat = Math.cos((leg.from.lat * Math.PI) / 180) || 1;
      const legM = Math.hypot(
        (leg.to.lat - leg.from.lat) * M_PER_LAT,
        (leg.to.lng - leg.from.lng) * M_PER_LAT * cosLat,
      );
      // Fraction of the leg walked. Linear on purpose — a dog crossing the
      // block at a steady pace is what reads as somebody out walking.
      const t = leg.durMs > 0 ? Math.min(1, (now - leg.startAt) / leg.durMs) : 1;
      // Standing still if there was nowhere to go, or we have arrived and
      // the next position hasn't landed yet.
      const walking = legM >= 0.5 && t < 1;
      if (walking !== movingRef.current) {
        movingRef.current = walking;
        setMoving(walking);
      }
      if (!walking) return;
      // Face the SCREEN-space direction of travel, so it's correct even
      // when the map is rotated. World dLng alone faced the wrong way on a
      // rotated map ("running backwards").
      const m = mapRef.current;
      if (m) {
        try {
          const dxPx =
            m.project([leg.to.lng, leg.to.lat]).x -
            m.project([leg.from.lng, leg.from.lat]).x;
          if (dxPx > 0.5) setFacingLeft(false);
          else if (dxPx < -0.5) setFacingLeft(true);
        } catch {
          /* project can throw mid-teardown — keep last facing */
        }
      }
      const next = {
        lat: leg.from.lat + (leg.to.lat - leg.from.lat) * t,
        lng: leg.from.lng + (leg.to.lng - leg.from.lng) * t,
      };
      posRef.current = next;
      setPos(next);
    }, 50);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPoke = () => {
    haptic('medium');
    setPoked(true);
    setTimeout(() => setPoked(false), 1500);
    void pokePlayer(player.id);
  };

  return (
    <MapLibreMarker
      position={pos}
      anchor="bottom"
      cullNearHorizon
      // Small margin on purpose: cull only when the dog's FEET are near the
      // horizon, not when its sprite pokes up — so close dogs never vanish at
      // steep pitch. We accept a little float on the truly-distant ones.
      cullSkyMarginPx={40}
      zIndex={Z.HUD_CHIPS - 2}
      onClick={onPoke}
    >
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          // Slightly translucent so other walkers read as "background life"
          // and don't compete with the player's own companion.
          opacity: 0.92,
          cursor: 'pointer',
        }}
      >
        {poked ? (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: -14,
              fontSize: 20,
              animation: 'poke-wave 1.4s ease-out forwards',
            }}
          >
            👋
          </div>
        ) : null}
        {/* The chip carries the colour of the ground this dog holds, so
            "whose zone is that" is answerable by looking at the dog
            standing on it — the territory layer paints the same hue.
            But that question only EXISTS while the ground is painted.
            On a walking map the colours were a dozen unexplained
            lozenges competing with everything else on screen, so there
            the tag is plain paper and just says who it is.

            Keyed to territoryVisible rather than to the mode, so the
            tag is coloured exactly when the ground under it is. No
            edge: a name tag is a readout, and readouts lost their ink
            along with the HUD meters — at 16px tall a 2px stroke is
            double the weight it carries on a card label anyway. */}
        <div
          style={{
            font: `600 10px ${SYSTEM_FONT}`,
            color: territoryVisible ? '#ffffff' : INK,
            background: territoryVisible ? ownerColorCss(player.id) : SURFACE.fill,
            borderRadius: R.label,
            padding: '1px 6px',
            marginBottom: 2,
            whiteSpace: 'nowrap',
            maxWidth: 96,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
          }}
        >
          {player.name}
        </div>
        <DogSprite anim={moving ? 'walking' : 'sitting'} facingLeft={facingLeft} scale={1.3} />
      </div>
    </MapLibreMarker>
  );
}
