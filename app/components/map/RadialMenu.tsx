import { balance } from '../../constants/balance';
import { BUTTON } from '../../constants/sizing';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { playPopThen } from '../../utils/popOnTap';
import { Icon, type IconName } from '../../components/ui/Icon';

export interface RadialAction {
  id: string;
  // Either iconName (renders as a pixel <Icon>) or icon (emoji
  // fallback for runtime-generated entries like visit:spot:<id>
  // that pull the spot's category emoji from gameStore).
  // Both are absent on text-variant items, which render their label.
  iconName?: IconName;
  icon?: string;
  label: string;
}

// L1 — the four intents. The angle formula below puts index 0 at twelve
// o'clock and walks clockwise, so this array IS the ring, and the order
// is load-bearing: 'гуляти' sits at the bottom because that is the
// everyday answer and the bottom is where a thumb already is on a walk
// (D-21). 'загубив' takes the top — the rarest and most deliberate of
// the four, and nobody reaching for it is doing so casually.
export type ModeActionId =
  | 'mode:lost'
  | 'mode:search'
  | 'mode:explore'
  | 'mode:play';

export const MODE_ACTION_IDS: ModeActionId[] = [
  'mode:lost',
  'mode:search',
  'mode:explore',
  'mode:play',
];

// L2 for 'гуляти' — the walking game's own verbs. `search` used to head
// this list; it is an L1 intent now, and leaving a copy here would mean
// two different depths of menu that both change mode.
export const EXPLORE_ACTIONS: RadialAction[] = [
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

// The four top-level intents are words, not pictures. There is no icon
// for "I lost my dog" that a stranger reads correctly on the first try,
// and this ring is the first thing anyone sees.
//
// A text item is a wide pill with the word inside it, rather than the
// icon variant's round button with a caption underneath. That changes
// the footprint, which is why CONTAINER is computed from the item width
// below instead of a fixed +80.
export const TEXT_ITEM = {
  width: 112,
  height: 44,
} as const;

// Trig-positioned radial around a center point with radius R.
// The container is sized to fit the rim items and centered on the companion.
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
  // 'icon' is the ring the app has always had. 'text' is the L1 intent
  // ring — word pills, no icons.
  variant?: 'icon' | 'text';
}

export function RadialMenu({
  open,
  actions,
  onSelect,
  radius = balance.menuRadius,
  inverted = false,
  showLabels = false,
  variant = 'icon',
}: RadialMenuProps) {
  const N = actions.length;
  const isText = variant === 'text';
  // How wide one rim item actually is. The icon variant's wrapper has
  // always been 100 (see the -50 offset below); the text variant's is
  // its pill.
  const ITEM_W = isText ? TEXT_ITEM.width : 100;
  // Menu container is centered on the parent via 50/50 + translate(-50,-50)
  // so the ring is truly centered on the companion, regardless of companion
  // size. It has to span the ring PLUS a whole item on each side, or the
  // left and right rim items hang outside it — which the old
  // `radius * 2 + 80` did by ~10px even for the six-icon ring, because 80
  // is less than the 100 an item occupies.
  const CONTAINER = radius * 2 + ITEM_W + 24;
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
              left: bx - ITEM_W / 2,
              top: by - (isText ? TEXT_ITEM.height / 2 : 28),
              width: ITEM_W,
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
                playPopThen(e.currentTarget, () => onSelect(a.id));
              }}
              style={{
                width: isText ? TEXT_ITEM.width : BUTTON.size,
                height: isText ? TEXT_ITEM.height : BUTTON.size,
                // Text pills are capsules; icon buttons are circles.
                borderRadius: isText ? TEXT_ITEM.height / 2 : BUTTON.radius,
                border: 'none',
                background: bg,
                color: fg,
                // One word has to survive at this size in Ukrainian, so
                // the pill takes body type rather than the icon variant's
                // hero glyph size.
                fontSize: isText ? TYPE.body : TYPE.hero,
                fontWeight: isText ? 700 : undefined,
                cursor: 'pointer',
                boxShadow: '0 6px 20px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                userSelect: 'none',
                whiteSpace: 'nowrap',
              }}
              aria-label={a.label}
            >
              {/* Icon sized via the shared BUTTON token — 0.79 ratio
                  reads calm against the dark glass disc without
                  feeling sparse like the 0.68 we tried last pass. */}
              {isText ? (
                a.label
              ) : a.iconName ? (
                <Icon name={a.iconName} size={BUTTON.icon} inverted={inverted} />
              ) : (
                a.icon
              )}
            </button>
            {/* The text variant already IS its label — a caption under it
                would say the word twice. */}
            {showLabels && !isText ? (
              <span
                style={{
                  marginTop: S.xs,
                  fontSize: TYPE.caption,
                  fontWeight: 700,
                  color: labelColor,
                  textShadow: labelShadow,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: ITEM_W,
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
