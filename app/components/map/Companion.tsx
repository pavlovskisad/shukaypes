import { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'react-native';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import { useGameStore } from '../../stores/gameStore';
import { SpeechBubble } from '../ui/SpeechBubble';
import { RadialMenu, PRIMARY_ACTIONS } from './RadialMenu';
import type { LatLng } from '@shukajpes/shared';
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
  const menuOpen = useGameStore((s) => s.menuOpen);
  const setMenuOpen = useGameStore((s) => s.setMenuOpen);
  const [localBubble, setLocalBubble] = useState<string | null>(null);
  // Track the "coming soon" bubble timeout so rapid menu taps don't
  // accumulate dangling timers — each new tap cancels the previous one.
  const bubbleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const label = PRIMARY_ACTIONS.find((a) => a.id === id)?.label ?? id;
      setLocalBubble(`${label}! coming soon 🐾`);
      if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current);
      bubbleTimeoutRef.current = setTimeout(() => setLocalBubble(null), 2500);
    },
    [setMenuOpen]
  );

  const activeBubble = bubble ?? localBubble;

  return (
    <OverlayViewF
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -65, y: -65 })}
    >
      <div
        style={{
          position: 'relative',
          width: 130,
          height: 130,
        }}
      >
        {/* companion body — just the nose glyph with a layered white glow.
            three stacked drop-shadows: tight bright halo, softer mid bloom,
            wide diffuse outer. reads as "strong presence" from a distance
            without a hard edge. no circle underneath. */}
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
              'drop-shadow(0 0 10px rgba(255,255,255,1)) drop-shadow(0 0 22px rgba(255,255,255,0.85)) drop-shadow(0 0 44px rgba(255,255,255,0.5))',
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
