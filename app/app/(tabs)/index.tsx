import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { View, Image, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView from '../../components/map';
import { StatusBar } from '../../components/ui/StatusBar';
import { QuestPill } from '../../components/ui/QuestPill';
import { useGameStore } from '../../stores/gameStore';
import logoSquare from '../../assets/logo-square.png';

// Logo is the brand anchor in the top-left. Prototype has it roughly
// pill-height; matching that so it reads as a peer of the status pill
// rather than dominating the map.
const HUD_ICON_SIZE = 55;

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
        {/* Active-quest banner centered under the top row. Renders
            nothing when no quest is live so it doesn't steal space. */}
        <View style={styles.questRow} pointerEvents="box-none">
          <QuestPill />
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
    // Center vertically so the pill sits on the logo's horizontal midline.
    // Equal paddingHorizontal keeps distance-to-edge matching on both sides.
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  logo: {
    width: HUD_ICON_SIZE,
    height: HUD_ICON_SIZE,
  },
  questRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
  },
});
