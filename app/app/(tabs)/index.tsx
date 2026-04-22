import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { View, Image, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView from '../../components/map';
import { StatusBar } from '../../components/ui/StatusBar';
import { useGameStore } from '../../stores/gameStore';
import logoSquare from '../../assets/logo-square.png';

// Logo is the brand anchor in the top-left. Bigger than the pill but not
// so big its internal transparent padding pushes the visible square far
// below where the pill sits.
const HUD_ICON_SIZE = 100;

export default function MapScreen() {
  useFocusEffect(useCallback(() => {
    useGameStore.getState().setScreen('map');
  }, []));

  return (
    <View style={styles.root}>
      <View style={styles.mapLayer}>
        <MapView />
      </View>
      <SafeAreaView style={styles.hud} pointerEvents="box-none" edges={['top']}>
        <View style={styles.hudRow}>
          <Image
            source={logoSquare}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="шукайпес"
          />
          <StatusBar />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  mapLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  hud: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  hudRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // Both items anchor to the top of the row — the pill stays at its
    // small size up top while the big logo extends down beside it.
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  logo: {
    width: HUD_ICON_SIZE,
    height: HUD_ICON_SIZE,
  },
});
