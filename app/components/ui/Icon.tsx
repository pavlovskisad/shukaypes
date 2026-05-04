import { Image } from 'react-native';

// Pixel-art icon set served from /public/icons/. Renders as an
// <Image> so the same component works in RN-Web (today's web pilot)
// and would work on native if/when we wire react-native-svg, since
// the markup never leans on raw <img>.
//
// New names slot in here as we extend the set. Keep the URL list
// flat — each icon is a single SVG, no per-icon variants.

export type IconName =
  | 'paws'
  | 'bone'
  | 'sun'
  | 'pin'
  | 'map'
  | 'chat'
  | 'task'
  | 'user';

const URL: Record<IconName, string> = {
  paws: '/icons/paws.svg',
  bone: '/icons/bone.svg',
  sun: '/icons/sun.svg',
  pin: '/icons/pin.svg',
  map: '/icons/map.svg',
  chat: '/icons/chat.svg',
  task: '/icons/task.svg',
  user: '/icons/user.svg',
};

// Per-icon size compensation. The asset SVGs come from different
// sources with different "padding" inside their viewBox — chat /
// user ship as solid silhouettes centered in a 100×100 box with
// significant whitespace around the shape, while the line-art set
// (map, task, pin, sun) fills its viewBox almost edge-to-edge. So
// at the same passed-in size, chat / user render visibly smaller.
// These multipliers bring them up to match the line-art family
// without re-cropping the assets.
const SIZE_SCALE: Partial<Record<IconName, number>> = {
  chat: 1.4,
  user: 1.4,
};

interface IconProps {
  name: IconName;
  size: number;
  // Optional opacity override — used by the spots-toggle pill that
  // greys the icon when the toggle is off.
  opacity?: number;
}

export function Icon({ name, size, opacity }: IconProps) {
  const finalSize = size * (SIZE_SCALE[name] ?? 1);
  return (
    <Image
      source={{ uri: URL[name] }}
      style={{ width: finalSize, height: finalSize, opacity }}
      resizeMode="contain"
    />
  );
}
