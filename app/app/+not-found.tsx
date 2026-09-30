// Any path the router does not know. `vercel.json` rewrites every
// unmatched URL to index.html, so a typo, a stale link or a truncated
// share lands here — and expo-router's default for that is an English
// "Unmatched Route" page with no way back into the app. There is only
// one sensible destination: the map.
import { Redirect } from 'expo-router';

export default function NotFound() {
  return <Redirect href="/" />;
}
