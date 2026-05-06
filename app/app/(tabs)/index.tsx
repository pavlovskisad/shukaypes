import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { View, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView from '../../components/map';
import { StatusBar } from '../../components/ui/StatusBar';
import { QuestPill } from '../../components/ui/QuestPill';
import { AboutModal } from '../../components/ui/AboutModal';
import { useGameStore } from '../../stores/gameStore';
import logoSquare from '../../assets/logo-square.png';

// Logo is the brand anchor in the top-left. Prototype has it roughly
// pill-height; matching that so it reads as a peer of the status pill
// rather than dominating the map.
const HUD_ICON_SIZE = 55;

// localStorage flag — once dismissed, the about sheet doesn't pop on
// future visits. Cheap onboarding without server state.
const ABOUT_SEEN_KEY = 'shukajpes:aboutSeen';

export default function MapScreen() {
  const [aboutOpen, setAboutOpen] = useState(false);

  useFocusEffect(useCallback(() => {
    useGameStore.getState().setScreen('map');
  }, []));

  // Auto-open on the first ever visit. Wrapped in try/catch in case
  // localStorage is unavailable (private mode etc) — failing silent
  // is fine, the user can still tap the logo.
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      if (!window.localStorage.getItem(ABOUT_SEEN_KEY)) {
        setAboutOpen(true);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleAboutClose = useCallback(() => {
    setAboutOpen(false);
    try {
      window.localStorage.setItem(ABOUT_SEEN_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.mapLayer}>
        <MapView />
      </View>
      <SafeAreaView style={styles.hud} pointerEvents="box-none" edges={['top']}>
        <View style={styles.hudRow}>
          <Pressable
            onPress={() => setAboutOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="about шукайпес"
            hitSlop={8}
          >
            <Image
              source={logoSquare}
              style={styles.logo}
              resizeMode="contain"
            />
          </Pressable>
          <StatusBar />
        </View>
        {/* Active-quest banner centered under the top row. Renders
            nothing when no quest is live so it doesn't steal space. */}
        <View style={styles.questRow} pointerEvents="box-none">
          <QuestPill />
        </View>
      </SafeAreaView>
      <AboutModal open={aboutOpen} onClose={handleAboutClose} />
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
    // paddingTop pushes the HUD a bit down from the top safe-area inset
    // so the off-screen lost-pet chips have room to sit at the actual
    // top edge of the screen without overlapping the logo / pills.
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 32,
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
