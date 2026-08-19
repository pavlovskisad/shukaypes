import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { View, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView from '../../components/map';
import { StatusBar, PillPulseRing } from '../../components/ui/StatusBar';
import { QuestPill } from '../../components/ui/QuestPill';
import { LostFlowModal } from '../../components/ui/LostFlowModal';
import { Z } from '../../constants/z';
import { S } from '../../constants/spacing';
import { popPressableEvent } from '../../utils/popOnTap';
import { useGameStore } from '../../stores/gameStore';

// Logo is the brand anchor in the top-left. Prototype has it roughly
// pill-height; matching that so it reads as a peer of the status pill
// rather than dominating the map.
const HUD_ICON_SIZE = 59;

// Bubble easing for the HUD pills as the mode changes. Slight overshoot
// on the way in reads as "popping into place"; the pop-in / pop-out
// keyframes are global CSS in public/index.html, because the dashboard
// shares them and outlives this screen.
const POP_IN = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

export default function MapScreen() {
  // Supersniff — the corner-logo button toggles it.
  const dogCam = useGameStore((s) => s.dogCam);
  const toggleDogCam = useGameStore((s) => s.toggleDogCam);
  const appMode = useGameStore((s) => s.appMode);
  const lostFlowOpen = useGameStore((s) => s.lostFlowOpen);
  const setLostFlowOpen = useGameStore((s) => s.setLostFlowOpen);
  // The dog is asking what we're doing. Nothing else on screen is real
  // until it's answered.
  const gateOpen = appMode === 'gate';
  // Immersive = the HUD bubbles out. Supersniff wants the screen for the
  // carousel; the gate wants it for the question. Same treatment, and
  // deliberately the same flag, so both get the one animation path
  // rather than two that drift.
  const immersive = dogCam || gateOpen;
  // When a logo-targeting hint is showing, pulse the logo so the spoken
  // line has a target: 'map:supersniff' calls the user to TRY the mode,
  // 'map:supersniff-exit' shows modal-arrived searchers the way BACK to
  // walks. Hint visibility is computed in the Companion and published to
  // the store as `activeHint`.
  const activeHint = useGameStore((s) => s.activeHint);
  const pulseLogo =
    activeHint === 'map:supersniff' || activeHint === 'map:supersniff-exit';
  // Pop animations on the HUD pills should only run during the brief
  // window around an actual sniff toggle, not on every re-render or
  // on initial mount. Static styles handle the steady state.
  const [sniffJustChanged, setSniffJustChanged] = useState(false);
  const sniffInitRef = useRef(true);
  // useLayoutEffect so `sniffJustChanged` flips in the same paint
  // cycle as sniffMode — without it there's a one-frame gap where the
  // new sniffMode static styles paint without the animation attached,
  // producing a visible blink before the animation kicks in.
  useLayoutEffect(() => {
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
  }, [immersive]);

  // The logo needs its OWN window, not `sniffJustChanged`. It stays put
  // through a supersniff toggle — it IS the supersniff toggle — and only
  // bubbles for the gate, so keying it on `immersive` would animate it
  // out and back every time somebody tapped it.
  const [gateJustChanged, setGateJustChanged] = useState(false);
  const gateInitRef = useRef(true);
  useLayoutEffect(() => {
    if (gateInitRef.current) {
      gateInitRef.current = false;
      return;
    }
    setGateJustChanged(true);
    const t = setTimeout(() => setGateJustChanged(false), 700);
    return () => clearTimeout(t);
  }, [gateOpen]);

  useFocusEffect(useCallback(() => {
    useGameStore.getState().setScreen('map');
  }, []));

  const handleLostFlowClose = useCallback(() => setLostFlowOpen(false), [setLostFlowOpen]);

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
        {/* box-none, not the default auto. This row is a full-width
            strip across the top of the screen with a logo at one end
            and the status pill at the other — the empty middle is
            layout, not a surface, and it was swallowing every tap that
            landed there. Nothing lived in that strip until the search
            HUD did, and raising the HUD's z-index is no way out: the
            map's parent stacking contexts trap MapView's children
            below this container regardless of the number (see the
            portal comment on the off-screen companion chip). Its two
            real children keep their own hit areas. */}
        <View style={styles.hudRow} pointerEvents="box-none">
          {/* The logo is a mode switch, so it leaves with the rest of the
              chrome while the gate is up — otherwise the one control that
              survives the question is one that answers it behind the
              ring's back. It pops out and back on the same clock as the
              status pill, one leg of the same stagger. */}
          <div
            style={{
              transformOrigin: 'left center',
              opacity: gateOpen ? 0 : 1,
              transform: gateOpen ? 'scale(0)' : 'scale(1)',
              animation: gateJustChanged
                ? gateOpen
                  ? `pop-out 320ms ease-in forwards`
                  : `pop-in 360ms ${POP_IN} 200ms both`
                : 'none',
              pointerEvents: gateOpen ? 'none' : 'auto',
            }}
          >
          <Pressable
            onPress={toggleDogCam}
            onPressIn={popPressableEvent}
            accessibilityRole="button"
            accessibilityLabel={dogCam ? 'turn supersniff off' : 'turn supersniff on'}
            hitSlop={8}
            style={{ position: 'relative' }}
          >
            {/* Super-sniff hint cue — the same blooming ring the HUD pills
                use, so every hint reads as one family. Expands out of the
                logo while the dog is calling the user to try it, giving the
                spoken line a target. */}
            {pulseLogo ? <PillPulseRing /> : null}
            {/* Corner logo — plain <div> with backgroundImage so CSS
                `filter: invert(1)` works reliably (the previous RN
                <Image> wrapper ate the filter on iOS Safari). SVG was
                potrace-traced from the original PNG for crisp
                scaling. */}
            <div
              style={{
                width: HUD_ICON_SIZE,
                height: HUD_ICON_SIZE,
                backgroundImage: 'url(/icons/logo.svg)',
                backgroundRepeat: 'no-repeat',
                backgroundSize: 'contain',
                backgroundPosition: 'center',
                animation: pulseLogo
                  ? 'hint-logo-pop 1.4s ease-in-out infinite'
                  : undefined,
              }}
            />
            {pulseLogo ? (
              <style>{`
                @keyframes hint-logo-pop {
                  0%, 100% { transform: scale(1); }
                  50%      { transform: scale(1.12); }
                }
              `}</style>
            ) : null}
          </Pressable>
          </div>
          {/* StatusBar bubbles out in sniff mode. Anchor the scale
              transform to the right edge so it collapses toward the
              edge of the screen rather than the centre. */}
          <div
            style={{
              transformOrigin: 'right center',
              opacity: immersive ? 0 : 1,
              transform: immersive ? 'scale(0)' : 'scale(1)',
              // Stagger: HUD collapses immediately on mode-on; on mode-off it
              // bubbles back in AFTER the chips have popped out (200ms delay).
              // `both` fill mode applies the 0% keyframe during the delay so the
              // HUD doesn't flash visible before the animation starts.
              animation: sniffJustChanged
                ? immersive
                  ? `pop-out 320ms ease-in forwards`
                  : `pop-in 360ms ${POP_IN} 200ms both`
                : 'none',
              pointerEvents: immersive ? 'none' : 'auto',
            }}
          >
            <StatusBar />
          </div>
        </View>
        {/* Quest banner bubbles out in immersive (search) mode too. */}
        <View
          style={styles.questRow}
          pointerEvents={immersive ? 'none' : 'box-none'}
        >
          <div
            style={{
              opacity: immersive ? 0 : 1,
              transform: immersive ? 'scale(0)' : 'scale(1)',
              animation: sniffJustChanged
                ? immersive
                  ? `pop-out 320ms ease-in forwards`
                  : `pop-in 360ms ${POP_IN} 200ms both`
                : 'none',
            }}
          >
            <QuestPill />
          </div>
        </View>
      </SafeAreaView>
      {/* Hosted here rather than inside MapView for the same reason the
          about sheet is: it has to sit above the dashboard, not under
          it. */}
      <LostFlowModal open={lostFlowOpen} onClose={handleLostFlowClose} />
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
    // Was 10, but the companion-bookmark overlay (rendered inside
    // MapView) had zIndex 24/25 yet still wasn't intercepting taps in
    // PWA/iOS Safari — the HUD wins hit
    // Lower than HUD_CHIPS so the off-screen chip overlay still wins.
    // Higher than markers so the HUD pills paint above the map.
    zIndex: Z.HUD_PILLS,
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
    paddingHorizontal: S.m,
    // Middle ground between the original 32 and the brought-up 12 —
    // header elements sit comfortably under the OS status bar without
    // crowding it.
    paddingTop: S.xxl,
  },
  questRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: S.s,
    paddingHorizontal: S.m,
  },
});
