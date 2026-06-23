import { balance } from '../../constants/balance';
import { BUTTON } from '../../constants/sizing';
import { TYPE } from '../../constants/type';
import { Icon, type IconName } from '../../components/ui/Icon';

export interface RadialAction {
  id: string;
  // Either iconName (renders as a pixel <Icon>) or icon (emoji
  // fallback for runtime-generated entries like visit:spot:<id>
  // that pull the spot's category emoji from gameStore).
  iconName?: IconName;
  icon: string;
  label: string;
}

export const PRIMARY_ACTIONS: RadialAction[] = [
  { id: 'search', iconName: 'search', icon: '🔍', label: 'search' },
  { id: 'walk', iconName: 'walk', icon: '🚶', label: 'walk' },
  { id: 'visit', iconName: 'pin', icon: '📍', label: 'visit' },
  { id: 'meet', iconName: 'meet', icon: '👥', label: 'meet' },
  { id: 'chat', iconName: 'chat', icon: '💬', label: 'chat' },
  // About / help — opened from the radial menu now that the logo
  // tap is wired to sniff-mode toggle. Keeps the onboarding sheet
  // one tap away.
  { id: 'about', iconName: 'question', icon: '❓', label: 'about' },
];

// Walk drills two levels deep: shape (roundtrip / one-way) → distance
// (close ~1km / far ~3km). Leaf fires the route flow.
export const WALK_SHAPE_ACTIONS: RadialAction[] = [
  { id: 'walk:roundtrip', iconName: 'roundtrip', icon: '🔄', label: 'roundtrip' },
  { id: 'walk:oneway', iconName: 'oneway', icon: '➡️', label: 'one-way' },
];

export const WALK_DISTANCE_ACTIONS: RadialAction[] = [
  { id: ':close', iconName: 'close', icon: '🏘', label: 'close' },
  { id: ':far', iconName: 'far', icon: '🌆', label: 'far' },
];

// Visit drills two levels deep: category → 3 closest spots in that
// category. Closest-spots level is computed at runtime in Companion.
export const VISIT_CATEGORY_ACTIONS: RadialAction[] = [
  { id: 'visit:cafe', iconName: 'cafe', icon: '☕', label: 'cafe' },
  { id: 'visit:restaurant', iconName: 'restaurant', icon: '🍜', label: 'food' },
  { id: 'visit:bar', iconName: 'bar', icon: '🍹', label: 'bar' },
  { id: 'visit:pet_store', iconName: 'pet_store', icon: '🐶', label: 'pet store' },
  { id: 'visit:veterinary_care', iconName: 'vet', icon: '⛑️', label: 'vet' },
];

// Trig-positioned radial around a center point (105, 105) with radius R (demo lines 187-210).
// The container div is 210x210 centered on the companion.
interface RadialMenuProps {
  open: boolean;
  actions: RadialAction[];
  onSelect: (id: string) => void;
  radius?: number;
  inverted?: boolean;
  // When true, render the action's label below the icon. Used at the
  // deepest drill-down (named spots) where the icon alone can't tell
  // a cafe from another cafe.
  showLabels?: boolean;
}

export function RadialMenu({
  open,
  actions,
  onSelect,
  radius = balance.menuRadius,
  inverted = false,
  showLabels = false,
}: RadialMenuProps) {
  const N = actions.length;
  // Menu container is centered on the parent via 50/50 + translate(-50,-50)
  // so the ring is truly centered on the companion, regardless of companion
  // size. Size is 2*radius + button + buffer so rim buttons fit.
  const CONTAINER = radius * 2 + 80;
  const CENTER = CONTAINER / 2;
  // Plain black-and-white pills — no frosted glass / translucency.
  // Sniff mode (dark map) uses the dark variant so the buttons stay
  // legible against the white-on-dark theme; normal map uses the
  // light variant. Caller passes `inverted={!sniffMode}`.
  const bg = inverted ? '#1a1a1a' : '#ffffff';
  const fg = inverted ? '#ffffff' : '#1a1a1a';
  const labelColor = inverted ? '#f5f5f5' : '#1a1a1a';
  const labelShadow = inverted
    ? '0 1px 4px rgba(0,0,0,0.95)'
    : '0 1px 4px rgba(255,255,255,0.95)';

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
          <div
            key={a.id}
            style={{
              position: 'absolute',
              left: bx - 50,
              top: by - 28,
              width: 100,
              opacity: open ? 1 : 0,
              transform: open ? 'scale(1)' : 'scale(0.4)',
              transition: `opacity 220ms ease ${i * 40}ms, transform 220ms ease ${i * 40}ms`,
              pointerEvents: open ? 'auto' : 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'flex-start',
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(a.id);
              }}
              style={{
                width: BUTTON.size,
                height: BUTTON.size,
                borderRadius: BUTTON.radius,
                border: 'none',
                background: bg,
                color: fg,
                fontSize: TYPE.hero,
                cursor: 'pointer',
                boxShadow: '0 6px 20px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                userSelect: 'none',
              }}
              aria-label={a.label}
            >
              {/* Icon sized via the shared BUTTON token — 0.79 ratio
                  reads calm against the dark glass disc without
                  feeling sparse like the 0.68 we tried last pass. */}
              {a.iconName ? <Icon name={a.iconName} size={BUTTON.icon} inverted={inverted} /> : a.icon}
            </button>
            {showLabels ? (
              <span
                style={{
                  marginTop: 4,
                  fontSize: TYPE.caption,
                  fontWeight: 700,
                  color: labelColor,
                  textShadow: labelShadow,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: 100,
                  textAlign: 'center',
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              >
                {a.label}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
