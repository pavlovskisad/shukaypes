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

// Walk drills two levels deep: shape (roundtrip / one-way) → distance
// (close ~1km / far ~3km). Leaf fires the route flow.
export const WALK_SHAPE_ACTIONS: RadialAction[] = [
  { id: 'walk:roundtrip', icon: '🔄', label: 'roundtrip' },
  { id: 'walk:oneway', icon: '➡️', label: 'one-way' },
];

export const WALK_DISTANCE_ACTIONS: RadialAction[] = [
  { id: ':close', icon: '🏘', label: 'close' },
  { id: ':far', icon: '🌆', label: 'far' },
];

// Visit drills two levels deep: category → 3 closest spots in that
// category. Closest-spots level is computed at runtime in Companion.
export const VISIT_CATEGORY_ACTIONS: RadialAction[] = [
  { id: 'visit:cafe', icon: '☕', label: 'cafe' },
  { id: 'visit:restaurant', icon: '🍜', label: 'food' },
  { id: 'visit:bar', icon: '🍹', label: 'bar' },
  { id: 'visit:pet_store', icon: '🐶', label: 'pet store' },
  { id: 'visit:veterinary_care', icon: '⛑️', label: 'vet' },
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
  // Menu container is centered on the parent via 50/50 + translate(-50,-50)
  // so the ring is truly centered on the companion, regardless of companion
  // size. Size is 2*radius + button + buffer so rim buttons fit.
  const CONTAINER = radius * 2 + 80;
  const CENTER = CONTAINER / 2;
  // Frosted-glass buttons regardless of `inverted`. `inverted` kept for
  // API compatibility but no longer changes colors.
  const bg = 'rgba(255,255,255,0.55)';
  const fg = '#1a1a1a';
  void inverted;

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: CONTAINER,
        height: CONTAINER,
        transform: 'translate(-50%, -50%)',
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
              fontSize: 22,
              cursor: 'pointer',
              opacity: open ? 1 : 0,
              transform: open ? 'scale(1)' : 'scale(0.4)',
              transition: `opacity 220ms ease ${i * 40}ms, transform 220ms ease ${i * 40}ms`,
              pointerEvents: open ? 'auto' : 'none',
              // Diffuse lift shadow — matches the pill reference.
              boxShadow: '0 6px 20px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.05)',
              backdropFilter: 'blur(8px) saturate(120%)',
              WebkitBackdropFilter: 'blur(8px) saturate(120%)',
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
