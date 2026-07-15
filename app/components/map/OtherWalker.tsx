import { useEffect, useRef, useState } from 'react';
import type { NearbyPlayer } from '@shukajpes/shared';
import { MapLibreMarker } from './MapLibreMarker';
import { useMaplibreMap } from './MapContext';
import { DogSprite } from './DogSprite';
import { Z } from '../../constants/z';
import { SYSTEM_FONT } from '../../constants/fonts';
import { useGameStore } from '../../stores/gameStore';
import { haptic } from '../../utils/haptics';

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
  // Latest reported (target) position — updated as new presence arrives.
  const targetRef = useRef(player.position);
  targetRef.current = player.position;

  // Animated position that eases toward the target each tick.
  const posRef = useRef({ ...player.position });
  const [pos, setPos] = useState({ ...player.position });
  const [facingLeft, setFacingLeft] = useState(false);
  const [moving, setMoving] = useState(false);
  // Brief "👋" confirmation after you poke this walker.
  const [poked, setPoked] = useState(false);
  const pokePlayer = useGameStore((s) => s.pokePlayer);
  // Kept in a ref so the []-deps glide interval always reads the current map
  // without re-creating. Used for screen-space facing (rotation-proof).
  const map = useMaplibreMap();
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    let last = typeof performance !== 'undefined' ? performance.now() : 0;
    // Exponential smoothing at ~20fps — glides to a new target over ~2s.
    const id = setInterval(() => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const dt = Math.min(0.2, (now - last) / 1000);
      last = now;
      const cur = posRef.current;
      const tgt = targetRef.current;
      const k = 1 - Math.exp(-1.6 * dt);
      const dLat = tgt.lat - cur.lat;
      const dLng = tgt.lng - cur.lng;
      // Metres of remaining travel (for moving/idle + to stop micro-jitter).
      const cosLat = Math.cos((cur.lat * Math.PI) / 180) || 1;
      const remM = Math.hypot(dLat * M_PER_LAT, dLng * M_PER_LAT * cosLat);
      if (remM < 0.5) {
        if (moving) setMoving(false);
        return;
      }
      // Face the SCREEN-space direction of travel (project cur → target), so
      // it's correct even when the map is rotated. World dLng alone faced the
      // wrong way on a rotated map ("running backwards").
      const m = mapRef.current;
      if (m) {
        try {
          const dxPx = m.project([tgt.lng, tgt.lat]).x - m.project([cur.lng, cur.lat]).x;
          if (dxPx > 0.5) setFacingLeft(false);
          else if (dxPx < -0.5) setFacingLeft(true);
        } catch {
          /* project can throw mid-teardown — keep last facing */
        }
      }
      if (!moving) setMoving(true);
      const next = { lat: cur.lat + dLat * k, lng: cur.lng + dLng * k };
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
        <div
          style={{
            font: `600 10px ${SYSTEM_FONT}`,
            color: '#2a2a2a',
            background: 'rgba(255,255,255,0.82)',
            borderRadius: 8,
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
