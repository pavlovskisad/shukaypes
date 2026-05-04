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
