import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { View, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView from '../../components/map';
import { StatusBar } from '../../components/ui/StatusBar';
import { QuestPill } from '../../components/ui/QuestPill';
import { AboutModal } from '../../components/ui/AboutModal';
import { useGameStore } from '../../stores/gameStore';

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
  // Pop animations on the HUD pills should only run during the brief
  // window around an actual sniff toggle, not on every re-render or
  // on initial mount. Static styles handle the steady state.
  const [sniffJustChanged, setSniffJustChanged] = useState(false);
  const sniffInitRef = useRef(true);
  useEffect(() => {
    if (sniffInitRef.current) {
      sniffInitRef.current = false;
      return;
    }
    setSniffJustChanged(true);
    // Match MapView's window so the staggered HUD/chip animations
    // (one leg delayed 200ms) get the full 200+360 = 560ms to play
    // before the flag clears.
    const t = setTimeout(() => setSniffJustChanged(false), 700);
    return () => clearTimeout(t);
  }, [sniffMode]);

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
            {/* Corner logo — plain <div> with backgroundImage so CSS
                `filter: invert(1)` works reliably (the previous RN
                <Image> wrapper ate the filter on iOS Safari). Sniff
                mode flips the black logo to white so it stays
                visible against the dark map. SVG was potrace-traced
                from the original PNG for crisp scaling. */}
            <div
              style={{
                width: HUD_ICON_SIZE,
                height: HUD_ICON_SIZE,
                backgroundImage: 'url(/icons/logo.svg)',
                backgroundRepeat: 'no-repeat',
                backgroundSize: 'contain',
                backgroundPosition: 'center',
                filter: sniffMode ? 'invert(1)' : undefined,
                transition: 'filter 220ms ease-out',
              }}
            />
          </Pressable>
          {/* StatusBar bubbles out in sniff mode. Anchor the scale
              transform to the right edge so it collapses toward the
              edge of the screen rather than the centre. */}
          <div
            style={{
              transformOrigin: 'right center',
              opacity: sniffMode ? 0 : 1,
              transform: sniffMode ? 'scale(0)' : 'scale(1)',
              // Stagger: HUD collapses immediately on sniff-on; on
              // sniff-off it bubbles back in AFTER the chips have
              // popped out (200ms delay). `both` fill mode applies
              // the 0% keyframe during the delay so the HUD doesn't
              // flash visible before the animation starts.
              animation: sniffJustChanged
                ? sniffMode
                  ? `pop-out 320ms ease-in forwards`
                  : `pop-in 360ms ${POP_IN} 200ms both`
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
              opacity: sniffMode ? 0 : 1,
              transform: sniffMode ? 'scale(0)' : 'scale(1)',
              // Stagger: HUD collapses immediately on sniff-on; on
              // sniff-off it bubbles back in AFTER the chips have
              // popped out (200ms delay). `both` fill mode applies
              // the 0% keyframe during the delay so the HUD doesn't
              // flash visible before the animation starts.
              animation: sniffJustChanged
                ? sniffMode
                  ? `pop-out 320ms ease-in forwards`
                  : `pop-in 360ms ${POP_IN} 200ms both`
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
    // Was 10, but the off-screen lost-pet chips and companion-bookmark
    // overlay (rendered inside MapView) had zIndex 24/25 yet still
    // weren't intercepting taps in PWA/iOS Safari — the HUD wins hit
    // tests because it's painted later in the DOM. Drop to 1 so the
    // overlay layer reliably stacks above the HUD.
    zIndex: 1,
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
  questRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
  },
});
