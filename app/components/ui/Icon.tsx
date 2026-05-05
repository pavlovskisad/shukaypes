import { Image } from 'react-native';

// Hand-drawn icon set served from /public/icons/. Renders as an
// <Image> so the same component works in RN-Web today and would
// work on native if/when we ship there.
//
// Vector SVGs auto-traced from the original 500×500 PNGs via
// potrace, with viewBoxes cropped to the actual content bbox
// (+8px padding) so each icon fills its bounding rect uniformly.
//
// Naming follows the visual ("house", not "user"; "eyes", not
// "sightings"). Slot identifiers describe the icon, not the
// surface that consumes it — many slots are used in multiple
// surfaces.

export type IconName =
  // HUD pills
  | 'paws'
  | 'bone'
  | 'sun'
  // Bottom tab bar
  | 'map'
  | 'task'
  | 'chat'
  | 'pin'
  | 'house'
  // Radial menu actions
  | 'walk'
  | 'search'
  | 'meet'
  | 'oneway'
  | 'roundtrip'
  | 'close'
  | 'far'
  // Spot categories
  | 'cafe'
  | 'restaurant'
  | 'bar'
  | 'pet_store'
  | 'vet'
  | 'all'
  // Lost-pet badges + sightings
  | 'urgent'
  | 'warning'
  | 'eyes';

const URL: Record<IconName, string> = {
  paws: '/icons/paws.svg',
  bone: '/icons/bone.svg',
  sun: '/icons/sun.svg',
  map: '/icons/map.svg',
  task: '/icons/task.svg',
  chat: '/icons/chat.svg',
  pin: '/icons/pin.svg',
  house: '/icons/house.svg',
  walk: '/icons/walk.svg',
  search: '/icons/search.svg',
  meet: '/icons/meet.svg',
  oneway: '/icons/oneway.svg',
  roundtrip: '/icons/roundtrip.svg',
  close: '/icons/close.svg',
  far: '/icons/far.svg',
  cafe: '/icons/cafe.svg',
  restaurant: '/icons/restaurant.svg',
  bar: '/icons/bar.svg',
  pet_store: '/icons/pet_store.svg',
  vet: '/icons/vet.svg',
  all: '/icons/all.svg',
  urgent: '/icons/urgent.svg',
  warning: '/icons/warning.svg',
  eyes: '/icons/eyes.svg',
};

// Per-icon size compensation. Most icons fill their tight viewBox
// solidly so a uniform `size` prop renders them at the same visual
// weight. Urgent siren has rays around it like the sun used to —
// keep a small bump there. Sun's viewBox is cropped tight to the
// central body (rays clipped to stubs); even so the body itself
// reads visually smaller than bone/paws silhouettes at size 18,
// so a modest 1.3× bump pulls it up to family weight. The
// happiness pill ends up ~5px wider than its neighbours — close
// enough that it still reads as part of the family, much tighter
// than the original 1.8× that made the pill obviously oversized.
const SIZE_SCALE: Partial<Record<IconName, number>> = {
  urgent: 1.3,
  sun: 1.3,
};

interface IconProps {
  name: IconName;
  size: number;
  // Optional opacity override — used by the spots-toggle pill that
  // greys the icon when the toggle is off.
  opacity?: number;
}

// Map a Google-Places-style spot category to its icon slot. The
// category strings come from services/places.ts SpotCategory.
// Returns null for any category we don't have a custom icon for —
// caller can fall back to the spot's stored emoji.
const CATEGORY_TO_ICON: Record<string, IconName> = {
  cafe: 'cafe',
  restaurant: 'restaurant',
  bar: 'bar',
  pet_store: 'pet_store',
  veterinary_care: 'vet',
};

export function iconForCategory(category: string): IconName | null {
  return CATEGORY_TO_ICON[category] ?? null;
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
