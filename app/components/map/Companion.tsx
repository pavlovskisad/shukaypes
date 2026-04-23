import { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'react-native';
import { useRouter } from 'expo-router';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import { useGameStore } from '../../stores/gameStore';
import { SpeechBubble } from '../ui/SpeechBubble';
import { RadialMenu, PRIMARY_ACTIONS } from './RadialMenu';
import type { LatLng } from '@shukajpes/shared';
import { distanceMeters } from '../../utils/geo';
import logoNose from '../../assets/logo-nose.png';

interface CompanionProps {
  position: LatLng;
  bubble: string | null;
  onTapCompanion?: () => void;
}

// Companion overlay — float keyframe, tap-to-open radial menu. All children
// (bubble, menu) live inside this OverlayView div so they move with the map
// (demo's floatPane pattern). The expanding aura rings were a bit much —
// we'll revisit that animation later when we have the right sensor metaphor.
export function Companion({ position, bubble, onTapCompanion }: CompanionProps) {
  const router = useRouter();
  const menuOpen = useGameStore((s) => s.menuOpen);
  const setMenuOpen = useGameStore((s) => s.setMenuOpen);
  const setSelectedDog = useGameStore((s) => s.setSelectedDog);
  const setSelectedSpot = useGameStore((s) => s.setSelectedSpot);
  const [localBubble, setLocalBubble] = useState<string | null>(null);
  // Track the "coming soon" bubble timeout so rapid menu taps don't
  // accumulate dangling timers — each new tap cancels the previous one.
  const bubbleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((msg: string, ms = 2500) => {
    setLocalBubble(msg);
    if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current);
    bubbleTimeoutRef.current = setTimeout(() => setLocalBubble(null), ms);
  }, []);

  useEffect(() => {
    return () => {
      if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current);
    };
  }, []);

  const handleTap = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (menuOpen) {
        setMenuOpen(false);
        return;
      }
      setMenuOpen(true);
      onTapCompanion?.();
    },
    [menuOpen, setMenuOpen, onTapCompanion]
  );

  const handleAction = useCallback(
    (id: string) => {
      setMenuOpen(false);
      // Each action pulls fresh data from the store so the handler doesn't
      // need to subscribe to every slice.
      const { lostDogs, spots, userPosition } = useGameStore.getState();

      switch (id) {
        case 'search': {
          // Find the closest lost pet to the user (not the companion —
          // companion wanders off) and open its modal. If none nearby,
          // tell the user instead of silently failing.
          if (!userPosition || lostDogs.length === 0) {
            flash('no lost pets in range yet');
            return;
          }
          const closest = lostDogs.reduce((best, d) => {
            const dd = distanceMeters(userPosition, d.lastSeen.position);
            const bd = distanceMeters(userPosition, best.lastSeen.position);
            return dd < bd ? d : best;
          }, lostDogs[0]!);
          setSelectedDog(closest.id);
          flash(`sniffed out ${closest.name} 🔍`);
          return;
        }
        case 'visit': {
          // Highlight the nearest spot if we've got one loaded; otherwise
          // send the user to the Spots tab so the fetch can kick off.
          if (spots.length > 0 && userPosition) {
            const closest = spots.reduce((best, s) => {
              const dd = distanceMeters(userPosition, s.position);
              const bd = distanceMeters(userPosition, best.position);
              return dd < bd ? s : best;
            }, spots[0]!);
            setSelectedSpot(closest.id);
            flash(`let's check out ${closest.name} ${closest.icon ?? '📍'}`);
            return;
          }
          router.push('/spots');
          return;
        }
        case 'chat': {
          router.push('/chat');
          return;
        }
        case 'walk': {
          // Minimal "walk" for now: if we know about spots, pick a random
          // one and suggest it. Directions API comes in a later slice.
          if (spots.length > 0 && userPosition) {
            const pick = spots[Math.floor(Math.random() * spots.length)]!;
            setSelectedSpot(pick.id);
            flash(`let's walk to ${pick.name} 🚶`);
          } else {
            flash('pick a spot first and i\'ll lead you there');
          }
          return;
        }
        case 'meet': {
          // Social / walker presence — not built yet. Honest no-op so
          // the user doesn't think the button's broken.
          flash('no walkers around yet 👥');
          return;
        }
        default: {
          const label = PRIMARY_ACTIONS.find((a) => a.id === id)?.label ?? id;
          flash(`${label}! coming soon 🐾`);
        }
      }
    },
    [setMenuOpen, setSelectedDog, setSelectedSpot, router, flash]
  );

  const activeBubble = bubble ?? localBubble;

  return (
    <OverlayViewF
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -85, y: -85 })}
    >
      <div
        style={{
          position: 'relative',
          width: 170,
          height: 170,
        }}
      >
        {/* Companion body — just the nose glyph sitting on a big intense
            white drop-shadow halo. No radar rings, no black circle — the
            logo has enough distinctive form on its own, the glow is what
            distinguishes it from the rest of the map. Stacked layers:
            inner tight bright halo, a mid bloom, and a wide atmospheric
            outer so it reads at any zoom. */}
        <div
          role="button"
          tabIndex={0}
          onClick={handleTap}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            animation: 'co-float 2.4s ease-in-out infinite',
            filter:
              'drop-shadow(0 0 14px rgba(255,255,255,1)) drop-shadow(0 0 30px rgba(255,255,255,1)) drop-shadow(0 0 60px rgba(255,255,255,0.75))',
            userSelect: 'none',
          }}
        >
          <Image
            source={logoNose}
            resizeMode="contain"
            style={{ width: '100%', height: '100%' }}
            accessibilityLabel="шукайпес"
          />
        </div>

        <SpeechBubble text={activeBubble} />
        <RadialMenu open={menuOpen} actions={PRIMARY_ACTIONS} onSelect={handleAction} />

        <style>{`
          @keyframes co-float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-3px); }
          }
        `}</style>
      </div>
    </OverlayViewF>
  );
}
