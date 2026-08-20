import type { ReactNode } from 'react';
import { balance } from '../../constants/balance';
import { BUTTON } from '../../constants/sizing';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { SURFACE } from '../../constants/surface';
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

// L2 for «хочу погуляти» — three ways to spend a walk, and nothing else.
//
// `search` left first: it is an L1 intent now, and a second copy down
// here would have meant two depths of menu that both change mode. Then
// `chat` and `about`, which were not walks at all — `chat` has its own
// place on the dashboard, and `about` moved to the profile tab, which
// is where a "what is this" sheet belongs anyway. What is left answers
// one question, which is why the dog can now name all three in a line.
export const EXPLORE_ACTIONS: RadialAction[] = [
  { id: 'walk', iconName: 'walk', icon: '🚶', label: 'walk' },
  { id: 'visit', iconName: 'pin', icon: '📍', label: 'visit' },
  { id: 'meet', iconName: 'meet', icon: '👥', label: 'meet' },
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
// `width` is the LAYOUT CELL, not the pill. The pill itself hugs its
// word — see the padding note on the button below — and is centred in
// this cell, which is what positions it on the ring and what the
// container is sized from. Keep it comfortably wider than the longest
// label plus its padding.
export const TEXT_ITEM = {
  width: 112,
  // Chunky enough to read as a sibling of the 68px icon discs rather
  // than a thin chip stuck to them.
  height: 60,
  // Was matched to SpeechBubble's 10 while the labels were single
  // words. Sentences need more room to breathe at this height, and the
  // pill is a touch target rather than a block of prose.
  padX: 18,
  // Caps the pill and lets a long answer wrap to two lines. Two of these
  // side by side plus the gap is 272px, which leaves ~44px of margin on
  // each side of a 360px screen.
  maxWidth: 130,
  // Between pills, both across a row and down a column.
  gap: 12,
} as const;

// Below the dog, both menus start here — far enough down to clear the
// VISIBLE sprite (~50px tall, not the 140px tap container it floats in)
// without leaving a gap you could park a bus in.
const BELOW_DOG_PX = 46;

// Between the icons in their row.
const ICON_ROW_GAP = 16;

// Three 68px discs and the two gaps between them.
const ROW_MAX_W = 3 * BUTTON.size + 2 * ICON_ROW_GAP;

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
  // menu — word pills, no icons.
  variant?: 'icon' | 'text';
  // Where the items go.
  //
  //   'ring' — the original, orbiting the dog. Still what the drill-down
  //            levels use, where every item is a 68px disc and there are
  //            only two or three of them.
  //   'row'  — one line of icons directly under the dog.
  //   'grid' — two columns of pills under the dog, filled COLUMN-FIRST:
  //            the first half of `actions` goes down the left column and
  //            the rest down the right.
  //
  // Both of the under-the-dog layouts leave the space above it empty,
  // which is what lets the dog's line sit at its nose instead of being
  // pushed up and over a button at twelve o'clock.
  layout?: 'ring' | 'row' | 'grid';
}

export function RadialMenu({
  open,
  actions,
  onSelect,
  radius = balance.menuRadius,
  inverted = false,
  showLabels = false,
  variant = 'icon',
  layout = 'ring',
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
  // Plain black-and-white buttons — no frosted glass / translucency.
  // The companion asks for the light variant everywhere now: white
  // fill, black text and glyphs, matching the HUD pills and the
  // dashboard. `inverted` flips the pair, and it also drives the Icon's
  // invert filter, so fill and glyph can never disagree.
  const bg = inverted ? '#1a1a1a' : '#ffffff';
  const fg = inverted ? '#ffffff' : '#1a1a1a';
  const labelColor = inverted ? '#f5f5f5' : '#1a1a1a';
  const labelShadow = inverted
    ? '0 1px 4px rgba(0,0,0,0.95)'
    : '0 1px 4px rgba(255,255,255,0.95)';

  // One answer. Shared by both layouts so a pill in a column and a pill
  // on a ring can never drift apart in shape, only in position.
  const renderButton = (a: RadialAction) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        playPopThen(e.currentTarget, () => onSelect(a.id));
      }}
      style={{
        // A TEXT PILL HUGS ITS LABEL, so its width says how long the
        // answer is. It used to be a fixed 112 with the label centred,
        // which gave it no padding at all — only leftover space, 27–36px
        // of it, and a different amount on every pill.
        width: isText ? 'max-content' : BUTTON.size,
        // Sentence answers must be allowed to wrap rather than run off
        // the screen; 300 keeps the longest to two lines at 360 wide.
        maxWidth: isText ? TEXT_ITEM.maxWidth : undefined,
        padding: isText ? `0 ${TEXT_ITEM.padX}px` : undefined,
        minHeight: isText ? TEXT_ITEM.height : BUTTON.size,
        height: isText ? undefined : BUTTON.size,
        // Text pills are capsules; icon buttons are circles. Same
        // family, and at 60 tall against the disc's 68 they read as
        // siblings rather than as a chip clipped onto a button.
        borderRadius: isText ? TEXT_ITEM.height / 2 : BUTTON.radius,
        // The same ink as the cards. border-box so the edge grows
        // inward — BUTTON.size is a fixed 68 and a content-box border
        // would quietly make every disc 72 and break the row's maths.
        border: SURFACE.hair,
        boxSizing: 'border-box',
        background: bg,
        color: fg,
        fontSize: isText ? TYPE.body : TYPE.hero,
        fontWeight: isText ? 700 : undefined,
        lineHeight: isText ? 1.25 : undefined,
        cursor: 'pointer',
        boxShadow: '0 6px 20px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        userSelect: 'none',
        // Nowrap was safe while every label was one word. It is not now.
        whiteSpace: isText ? 'normal' : 'nowrap',
      }}
      aria-label={a.label}
    >
      {/* Icon sized via the shared BUTTON token — 0.79 ratio reads calm
          against the dark disc without feeling sparse. */}
      {isText ? (
        a.label
      ) : a.iconName ? (
        <Icon name={a.iconName} size={BUTTON.icon} inverted={inverted} />
      ) : (
        a.icon
      )}
    </button>
  );

  // Shared so text pills and icon discs arrive identically — see the
  // keyframe note in public/index.html for why it is an animation and
  // not only a transition.
  const entrance = (i: number) => ({
    opacity: open ? 1 : 0,
    transform: open ? 'scale(1)' : 'scale(0.4)',
    transition: `opacity 220ms ease ${i * 40}ms, transform 220ms ease ${i * 40}ms`,
    animation: open ? `radial-item-in 220ms ease ${i * 40}ms both` : undefined,
    pointerEvents: (open ? 'auto' : 'none') as 'auto' | 'none',
  });

  // Shared shell for both under-the-dog layouts: centred on the dog
  // horizontally, hanging below it, and inert except for its buttons.
  // `width` is EXPLICIT and has to be. This element is absolutely
  // positioned inside the companion's 140px box, so left:50% leaves it
  // 70px of available width to shrink-wrap into — which no-wrap layouts
  // simply overflowed and ignored, but a wrapping one obeys. Measured:
  // with only a maxWidth set, three 68px icons wrapped onto three rows.
  const below = (children: ReactNode, gap: number, width: number) => (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: `calc(50% + ${BELOW_DOG_PX}px)`,
        transform: 'translateX(-50%)',
        width,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        rowGap: gap,
        columnGap: gap,
        pointerEvents: 'none',
      }}
    >
      {children}
    </div>
  );

  if (layout === 'row') {
    return below(
      actions.map((a, i) => (
        <div
          key={a.id}
          style={{
            ...entrance(i),
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: showLabels ? ITEM_W : undefined,
          }}
        >
          {renderButton(a)}
          {/* The named-spot level needs its names: one cafe disc looks
              exactly like another. */}
          {showLabels ? (
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
      )),
      ICON_ROW_GAP,
      // Three items across and no more, so the five visit categories
      // break 3 + 2 rather than running off a 360px screen. Two- and
      // three-item levels fill it exactly and never wrap. The named-spot
      // level needs wider cells because it carries labels.
      showLabels ? 3 * ITEM_W + 2 * ICON_ROW_GAP : ROW_MAX_W,
    );
  }

  if (layout === 'grid') {
    // Column-first, so `actions` reads down the left column and then
    // down the right — which is how the four intents are ordered.
    const half = Math.ceil(N / 2);
    const columns = [actions.slice(0, half), actions.slice(half)];
    return below(
      columns.map((col, c) => (
        <div
          key={c}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: TEXT_ITEM.gap,
          }}
        >
          {col.map((a, r) => (
            // Stagger by position in the whole set, not within the
            // column, so the four arrive as one sweep.
            <div key={a.id} style={entrance(c * half + r)}>
              {renderButton(a)}
            </div>
          ))}
        </div>
      )),
      TEXT_ITEM.gap,
      2 * TEXT_ITEM.maxWidth + TEXT_ITEM.gap,
    );
  }

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
              ...entrance(i),
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'flex-start',
            }}
          >
            {renderButton(a)}
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
