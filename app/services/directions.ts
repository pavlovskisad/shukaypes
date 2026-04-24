import type { LatLng } from '@shukajpes/shared';

// Walking-mode directions via the already-loaded google.maps JS API.
// Kept separate from places.ts because this one needs the `routes`
// library. `useJsApiLoader` in MapView loads `places` today; when we
// first use this, google.maps.DirectionsService comes along regardless
// because core maps ships it. No extra library load required.

// We ignore the full DirectionsResult shape and just flatten every
// polyline path in the first route's legs/steps — that's what renders
// as a street-hugging line through the waypoints.

export async function fetchWalkingRoute(
  origin: LatLng,
  waypoints: LatLng[],
): Promise<LatLng[] | null> {
  if (typeof google === 'undefined' || !google.maps) return null;
  if (waypoints.length === 0) return null;
  const svc = new google.maps.DirectionsService();
  const destination = waypoints[waypoints.length - 1]!;
  const intermediate = waypoints.slice(0, -1).map((p) => ({
    location: p as unknown as google.maps.LatLngLiteral,
    stopover: true,
  }));
  return new Promise((resolve) => {
    svc.route(
      {
        origin: origin as unknown as google.maps.LatLngLiteral,
        destination: destination as unknown as google.maps.LatLngLiteral,
        waypoints: intermediate,
        travelMode: google.maps.TravelMode.WALKING,
      },
      (res, status) => {
        if (status !== google.maps.DirectionsStatus.OK || !res) {
          resolve(null);
          return;
        }
        const path: LatLng[] = [];
        for (const leg of res.routes[0]?.legs ?? []) {
          for (const step of leg.steps ?? []) {
            for (const p of step.path ?? []) {
              path.push({ lat: p.lat(), lng: p.lng() });
            }
          }
        }
        resolve(path.length ? path : null);
      },
    );
  });
}
