import { Image } from 'react-native';

// Hand-drawn icon set served from /public/icons/. Renders as an
// <Image> so the same component works in RN-Web today and would
// work on native if/when we ship there.
//
// Vector SVGs auto-traced from the original 500×500 PNGs via
// potrace, with viewBoxes cropped to the actual content bbox so
// each icon fills its bounding rect uniformly — no per-icon size
// compensation needed at the consumer side.
//
// Naming follows the visual: `house` (the home tab), not "user"
// or "profile". Slot identifiers describe the icon, not the
// surface that consumes it.

export type IconName =
  | 'paws'
  | 'bone'
  | 'sun'
  | 'pin'
  | 'map'
  | 'chat'
  | 'task'
  | 'house';

const URL: Record<IconName, string> = {
  paws: '/icons/paws.svg',
  bone: '/icons/bone.svg',
  sun: '/icons/sun.svg',
  pin: '/icons/pin.svg',
  map: '/icons/map.svg',
  chat: '/icons/chat.svg',
  task: '/icons/task.svg',
  house: '/icons/house.svg',
};

interface IconProps {
  name: IconName;
  size: number;
  // Optional opacity override — used by the spots-toggle pill that
  // greys the icon when the toggle is off.
  opacity?: number;
}

export function Icon({ name, size, opacity }: IconProps) {
  return (
    <Image
      source={{ uri: URL[name] }}
      style={{ width: size, height: size, opacity }}
      resizeMode="contain"
    />
  );
}
