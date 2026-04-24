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

  // Hide bubbles while the radial menu is open — otherwise the bubble
  // (above the companion) and the top "search" button fight for the
  // same vertical slot.
  const activeBubble = menuOpen ? null : bubble ?? localBubble;

  return (
    <OverlayViewF
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -60, y: -60 })}
    >
      {/* Outer container is 120×120 — the entire box is the tap target
          even though the visible nose glyph is only 55×55 centered.
          Previously the tappable area matched the small visual glyph,
          which — combined with the companion's constant motion plus the
          glow filter visually implying a bigger hit zone — meant a lot
          of map-zoomed-out taps missed entirely. */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleTap}
        style={{
          position: 'relative',
          width: 120,
          height: 120,
          cursor: 'pointer',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Frosted-glass halo behind the nose. Same recipe the POIs used
            to carry — rgba(255,255,255,0.2) + blur(14px) saturate(160%)
            — which we had to strip from POIs because 20 simultaneous
            backdrop-filter layers murdered scroll perf. On a single
            instance like the companion it's fine, and it reads as a
            soft glass bubble around the dog. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            width: 66,
            height: 66,
            borderRadius: '50%',
            // Barely-there tint — the shape comes from the backdrop blur
            // + saturate, not the bg. 0.2 white read as a solid disk;
            // 0.05 lets what's underneath (map, paws) ghost through and
            // only the lensing sells the bubble.
            background: 'rgba(255,255,255,0.05)',
            backdropFilter: 'blur(14px) saturate(160%)',
            WebkitBackdropFilter: 'blur(14px) saturate(160%)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
            pointerEvents: 'none',
          }}
        />

        {/* Companion body — 55×55 nose glyph with layered white halo,
            centered in the larger tap container. pointer-events:none so
            the tap is captured by the outer container and not swallowed
            by the glyph's filter hitmap. */}
        <div
          aria-hidden
          style={{
            position: 'relative',
            width: 55,
            height: 55,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'co-float 2.4s ease-in-out infinite',
            filter:
              'drop-shadow(0 0 10px rgba(255,255,255,1)) drop-shadow(0 0 22px rgba(255,255,255,1)) drop-shadow(0 0 44px rgba(255,255,255,0.7))',
            pointerEvents: 'none',
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
