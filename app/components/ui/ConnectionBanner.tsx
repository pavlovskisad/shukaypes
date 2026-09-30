// The one component that reads whether the app can reach the server.
//
// Until now nothing did. `lastSyncError` was written at nineteen sites in
// gameStore and read nowhere, so every network failure was swallowed in
// silence: on a metro platform the paws stop appearing, the dog stops
// answering, and the app looks broken rather than disconnected. Those are
// very different messages to send somebody who is standing outside in
// Kyiv trying to help find a lost animal.
//
// DELIBERATELY SMALL AND DELIBERATELY QUIET. It appears only after two
// consecutive failures — roughly thirty seconds of nothing working — so a
// tunnel or a mast handover does not flash a warning people learn to
// ignore. It does not block anything, offers no retry button (the sync
// loops are already retrying), and disappears the moment one response
// gets through.
//
// It says things will CATCH UP, not that something failed. Nothing has
// been lost: collected paws are optimistic locally, and the next
// successful sync reconciles. The message people need is "keep walking,
// this will catch up", not an apology. It shows on every tab, so the
// line names no screen (it used to say "the map" on the profile too).
//
// AT THE BOTTOM, just above the tab bar (UX-7.5). At the top it sat on
// the logo and the status pills, and the row under them belongs to the
// quest pill.

import { View, Text, StyleSheet } from 'react-native';
import { useConnectionStore } from '../../stores/connectionStore';
import { useStrings } from '../../i18n/useStrings';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { INK } from '../../constants/surface';
import { Z } from '../../constants/z';
import { useTabBarClearance } from '../../hooks/useTabBarClearance';
import { usePwaInsetOvershoot } from '../../hooks/usePwaInsetOvershoot';

export function ConnectionBanner() {
  const status = useConnectionStore((s) => s.status);
  // Laid out from the root's bottom edge, so the installed PWA's
  // overshoot goes on top of the bar's clearance, as it does for the bar.
  const bottom = useTabBarClearance() + usePwaInsetOvershoot() + S.s;
  const t = useStrings();

  if (status === 'ok') return null;

  return (
    <View
      style={[styles.wrap, { bottom }]}
      // Announced to screen readers, since the visual cue is the whole
      // point and somebody using VoiceOver would otherwise get nothing.
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      // Never eat a tap meant for the map underneath.
      pointerEvents="none"
    >
      <Text style={styles.text}>
        {status === 'slow' ? t.connection.slow : t.connection.offline}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignSelf: 'center',
    left: 0,
    right: 0,
    alignItems: 'center',
    // The Ukrainian offline line is long; at 320 px it wraps inside
    // the gutter instead of running edge to edge.
    paddingHorizontal: S.m,
    // Above the map and the HUD, below any modal. See z.ts.
    zIndex: Z.BANNER,
  },
  text: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: R.pill,
    backgroundColor: INK,
    color: '#ffffff',
    fontSize: TYPE.small,
    textAlign: 'center',
    overflow: 'hidden',
  },
});
