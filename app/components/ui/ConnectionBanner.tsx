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
// It says the map will WAIT, not that something failed. Nothing has been
// lost: collected paws are optimistic locally, and the next successful
// sync reconciles. The message people need is "keep walking, this will
// catch up", not an apology.

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { View, Text, StyleSheet } from 'react-native';
import { useConnectionStore } from '../../stores/connectionStore';
import { useStrings } from '../../i18n/useStrings';

export function ConnectionBanner() {
  const status = useConnectionStore((s) => s.status);
  const insets = useSafeAreaInsets();
  const t = useStrings();

  if (status === 'ok') return null;

  return (
    <View
      style={[styles.wrap, { top: insets.top + 8 }]}
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
    // Above the map and the HUD, below any modal.
    zIndex: 50,
  },
  text: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(43,43,38,0.88)',
    color: '#F3F0E7',
    fontSize: 13,
    overflow: 'hidden',
  },
});
