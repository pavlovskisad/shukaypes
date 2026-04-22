import { Circle } from '@react-google-maps/api';
import type { LatLng, UrgencyLevel } from '@shukajpes/shared';

const URGENCY_COLOR: Record<UrgencyLevel, string> = {
  urgent: '#e84040',
  medium: '#d9a030',
  resolved: '#aaa',
};

interface SearchZoneCircleProps {
  center: LatLng;
  radiusM: number;
  urgency: UrgencyLevel;
}

// Very subtle search-zone circle. Demo used 180m at 4% fill; server returns a
// per-dog radius (300-2000m depending on urgency), so we honor that directly.
export function SearchZoneCircle({ center, radiusM, urgency }: SearchZoneCircleProps) {
  const color = URGENCY_COLOR[urgency];
  return (
    <Circle
      center={center as unknown as google.maps.LatLngLiteral}
      radius={radiusM}
      options={{
        strokeColor: color,
        strokeOpacity: 0.35,
        strokeWeight: 1,
        fillColor: color,
        fillOpacity: 0.04,
        clickable: false,
      }}
    />
  );
}
