import { balance } from '../../constants/balance';

export interface RadialAction {
  id: string;
  icon: string;
  label: string;
}

export const PRIMARY_ACTIONS: RadialAction[] = [
  { id: 'search', icon: '🔍', label: 'search' },
  { id: 'walk', icon: '🚶', label: 'walk' },
  { id: 'visit', icon: '📍', label: 'visit' },
  { id: 'meet', icon: '👥', label: 'meet' },
  { id: 'chat', icon: '💬', label: 'chat' },
];

// Trig-positioned radial around a center point (105, 105) with radius R (demo lines 187-210).
// The container div is 210x210 centered on the companion.
interface RadialMenuProps {
  open: boolean;
  actions: RadialAction[];
  onSelect: (id: string) => void;
  radius?: number;
  inverted?: boolean;
}

export function RadialMenu({
  open,
  actions,
  onSelect,
  radius = balance.menuRadius,
  inverted = false,
}: RadialMenuProps) {
  const N = actions.length;
  const CENTER = 105;
  const bg = inverted ? '#ffffff' : '#1a1a1a';
  const fg = inverted ? '#1a1a1a' : '#ffffff';

  return (
    <div
      style={{
        position: 'absolute',
        left: -60,
        top: -60,
        width: 210,
        height: 210,
        pointerEvents: 'none',
      }}
    >
      {actions.map((a, i) => {
        const ang = -Math.PI / 2 + i * ((2 * Math.PI) / N);
        const bx = CENTER + Math.cos(ang) * radius;
        const by = CENTER + Math.sin(ang) * radius;
        return (
          <button
            key={a.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(a.id);
            }}
            style={{
              position: 'absolute',
              left: bx - 28,
              top: by - 28,
              width: 56,
              height: 56,
              borderRadius: 28,
              border: 'none',
              background: bg,
              color: fg,
              fontSize: 20,
              cursor: 'pointer',
              opacity: open ? 1 : 0,
              transform: open ? 'scale(1)' : 'scale(0.4)',
              transition: `opacity 220ms ease ${i * 40}ms, transform 220ms ease ${i * 40}ms`,
              pointerEvents: open ? 'auto' : 'none',
              boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              userSelect: 'none',
            }}
            aria-label={a.label}
          >
            {a.icon}
          </button>
        );
      })}
    </div>
  );
}
