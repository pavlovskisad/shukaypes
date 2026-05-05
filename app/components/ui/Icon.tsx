import { Image } from 'react-native';

// Hand-drawn icon set served from /public/icons/. Renders as an
// <Image> so the same component works in RN-Web today and would
// work on native if/when we ship there.
//
// All icons are uniformly framed PNGs (500×500, transparent
// background) — no per-icon size compensation needed; each one
// fills its bounding box predictably.
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
  paws: '/icons/paws.png',
  bone: '/icons/bone.png',
  sun: '/icons/sun.png',
  pin: '/icons/pin.png',
  map: '/icons/map.png',
  chat: '/icons/chat.png',
  task: '/icons/task.png',
  house: '/icons/house.png',
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
