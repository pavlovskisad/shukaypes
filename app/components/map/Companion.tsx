import { useCallback, useState } from 'react';
import { OverlayViewF, FLOAT_PANE } from '@react-google-maps/api';
import { useGameStore } from '../../stores/gameStore';
import { SpeechBubble } from '../ui/SpeechBubble';
import { RadialMenu, PRIMARY_ACTIONS } from './RadialMenu';
import type { LatLng } from '@shukajpes/shared';

interface CompanionProps {
  position: LatLng;
  bubble: string | null;
  onTapCompanion?: () => void;
}

// Companion overlay — aura rings, float keyframe, tap-to-open radial menu.
// All children (bubble, menu) live inside this OverlayView div so they move
// with the map (demo's floatPane pattern).
export function Companion({ position, bubble, onTapCompanion }: CompanionProps) {
  const menuOpen = useGameStore((s) => s.menuOpen);
  const setMenuOpen = useGameStore((s) => s.setMenuOpen);
  const [localBubble, setLocalBubble] = useState<string | null>(null);

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
      setTimeout(() => setLocalBubble(null), 2500);
    },
    [setMenuOpen]
  );

  const activeBubble = bubble ?? localBubble;

  return (
    <OverlayViewF
      position={position as unknown as google.maps.LatLngLiteral}
      mapPaneName={FLOAT_PANE}
      getPixelPositionOffset={() => ({ x: -45, y: -45 })}
    >
      <div
        style={{
          position: 'relative',
          width: 90,
          height: 90,
        }}
      >
        {/* aura rings */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '3px solid rgba(255,255,255,1)',
            animation: 'co-aura 3s ease-out infinite',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '3px solid rgba(255,255,255,1)',
            animation: 'co-aura 3s ease-out infinite 1.5s',
            pointerEvents: 'none',
          }}
        />

        {/* companion body */}
        <div
          role="button"
          tabIndex={0}
          onClick={handleTap}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: '#1a1a1a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 44,
            color: '#ffffff',
            cursor: 'pointer',
            animation: 'co-float 2.4s ease-in-out infinite',
            boxShadow: '0 4px 18px rgba(0,0,0,0.35)',
            userSelect: 'none',
          }}
        >
          🐕
        </div>

        <SpeechBubble text={activeBubble} />
        <RadialMenu open={menuOpen} actions={PRIMARY_ACTIONS} onSelect={handleAction} />

        <style>{`
          @keyframes co-aura {
            0% { transform: scale(1); opacity: 0.7; }
            100% { transform: scale(8); opacity: 0; }
          }
          @keyframes co-float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-3px); }
          }
        `}</style>
      </div>
    </OverlayViewF>
  );
}
