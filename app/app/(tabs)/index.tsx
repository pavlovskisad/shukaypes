import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { View, Image, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView from '../../components/map';
import { StatusBar } from '../../components/ui/StatusBar';
import { QuestPill } from '../../components/ui/QuestPill';
import { AboutModal } from '../../components/ui/AboutModal';
import { useGameStore } from '../../stores/gameStore';
import logoSquare from '../../assets/logo-square.png';
import logoSquareInverse from '../../assets/logo-square-inverse.png';

// Logo is the brand anchor in the top-left. Prototype has it roughly
// pill-height; matching that so it reads as a peer of the status pill
// rather than dominating the map.
const HUD_ICON_SIZE = 55;

// localStorage flag — once dismissed, the about sheet doesn't pop on
// future visits. Cheap onboarding without server state.
const ABOUT_SEEN_KEY = 'shukajpes:aboutSeen';

// Bubble keyframes for HUD pills + edge chips when sniff mode toggles.
// Used by both this file (HUD pills) and MapView (edge chips) so
// transitions feel coordinated. Slight overshoot easing on the way in
// reads as "popping into place".
const POP_IN = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

export default function MapScreen() {
  const aboutOpen = useGameStore((s) => s.aboutOpen);
  const setAboutOpen = useGameStore((s) => s.setAboutOpen);
  const sniffMode = useGameStore((s) => s.sniffMode);
  const toggleSniffMode = useGameStore((s) => s.toggleSniffMode);
  // Track whether the user has ever toggled sniff. Suppresses the
  // hud-pop-in animation on initial mount (sniffMode starts false; the
  // HUD's "default visible" state shouldn't replay the pop-in keyframe
  // every time the screen mounts).
  const sniffWasEverOnRef = useRef(false);
  if (sniffMode) sniffWasEverOnRef.current = true;
  const sniffEverOn = sniffWasEverOnRef.current;

  useFocusEffect(useCallback(() => {
    useGameStore.getState().setScreen('map');
  }, []));

  // Auto-open the about sheet on the first ever visit. Wrapped in
  // try/catch in case localStorage is unavailable (private mode etc) —
  // failing silent is fine, the user can still tap the "?" button in
  // the companion's radial menu.
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      if (!window.localStorage.getItem(ABOUT_SEEN_KEY)) {
        setAboutOpen(true);
      }
    } catch {
      // ignore
    }
  }, [setAboutOpen]);

  const handleAboutClose = useCallback(() => {
    setAboutOpen(false);
    try {
      window.localStorage.setItem(ABOUT_SEEN_KEY, '1');
    } catch {
      // ignore
    }
  }, [setAboutOpen]);

  return (
    <View style={styles.root}>
      <View style={styles.mapLayer}>
        <MapView />
      </View>
      {/* Map renders full-screen under the phone status bar (becomes
          the bg for it — design thing). HUD itself still respects the
          top safe-area inset via `edges={['top']}` so the logo / pills
          aren't sitting under the OS status bar. */}
      <SafeAreaView style={styles.hud} pointerEvents="box-none" edges={['top']}>
        <View style={styles.hudRow}>
          <Pressable
            onPress={toggleSniffMode}
            accessibilityRole="button"
            accessibilityLabel={
              sniffMode ? 'exit sniff mode' : 'enter sniff mode'
            }
            hitSlop={8}
          >
            {/* Logo. Sniff mode swaps to a separate inverse asset
                (white outlines + nose) on a black rounded-square pill.
                The CSS `filter: invert(1)` route had rendering quirks
                on iOS Safari (showed as a solid black square), so we
                ship a real second asset and cross-fade between them. */}
            <div
              style={{
                position: 'relative',
                width: HUD_ICON_SIZE,
                height: HUD_ICON_SIZE,
                borderRadius: 12,
                background: sniffMode ? '#000' : 'transparent',
                transition: 'background-color 220ms ease-out',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              <Image
                source={logoSquare}
                style={[
                  styles.logo,
                  styles.logoStacked,
                  // CSS `transition` isn't in RN's ImageStyle type —
                  // web target only, so cast to any for the inline.
                  {
                    opacity: sniffMode ? 0 : 1,
                    transition: 'opacity 220ms ease-out',
                  } as any,
                ]}
                resizeMode="contain"
              />
              <Image
                source={logoSquareInverse}
                style={[
                  styles.logo,
                  styles.logoStacked,
                  {
                    opacity: sniffMode ? 1 : 0,
                    transition: 'opacity 220ms ease-out',
                  } as any,
                ]}
                resizeMode="contain"
              />
            </div>
          </Pressable>
          {/* StatusBar bubbles out in sniff mode. Anchor the scale
              transform to the right edge so it collapses toward the
              edge of the screen rather than the centre. */}
          <div
            style={{
              transformOrigin: 'right center',
              animation: sniffEverOn
                ? sniffMode
                  ? `hud-pop-out 320ms ease-in forwards`
                  : `hud-pop-in 360ms ${POP_IN} forwards`
                : 'none',
              pointerEvents: sniffMode ? 'none' : 'auto',
            }}
          >
            <StatusBar />
          </div>
        </View>
        {/* Quest banner bubbles out in sniff mode too. */}
        <View
          style={styles.questRow}
          pointerEvents={sniffMode ? 'none' : 'box-none'}
        >
          <div
            style={{
              animation: sniffEverOn
                ? sniffMode
                  ? `hud-pop-out 320ms ease-in forwards`
                  : `hud-pop-in 360ms ${POP_IN} forwards`
                : 'none',
            }}
          >
            <QuestPill />
          </div>
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
    // paddingTop is small now — the SafeAreaView no longer adds a top
    // inset (we want map + HUD to reach the very top of the screen),
    // so this is the only top-spacing the HUD has.
    alignItems: 'center',
    paddingHorizontal: 12,
    // Middle ground between the original 32 and the brought-up 12 —
    // header elements sit comfortably under the OS status bar without
    // crowding it.
    paddingTop: 22,
  },
  logo: {
    width: HUD_ICON_SIZE,
    height: HUD_ICON_SIZE,
  },
  // Both logo variants stack absolutely so we can cross-fade between
  // them on sniff-mode toggle without the layout shifting.
  logoStacked: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  questRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
  },
});
