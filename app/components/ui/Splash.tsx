import { useEffect, useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import logoFull from '../../assets/logo-full.png';

// Simple first-load splash. Overlays everything, fades out after a short
// beat. Web-specific — Expo's native splash-screen plugin covers iOS/
// Android separately. Keeps the brand the first thing you see even while
// the bundle finishes booting (cold load on mobile LTE can take a second).
const VISIBLE_MS = 1000;
const FADE_MS = 400;

export function Splash() {
  const [phase, setPhase] = useState<'visible' | 'fading' | 'hidden'>('visible');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('fading'), VISIBLE_MS);
    const t2 = setTimeout(() => setPhase('hidden'), VISIBLE_MS + FADE_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (phase === 'hidden') return null;

  return (
    <View
      style={[
        styles.overlay,
        { opacity: phase === 'fading' ? 0 : 1 },
      ]}
      pointerEvents={phase === 'fading' ? 'none' : 'auto'}
    >
      <Image source={logoFull} resizeMode="contain" style={styles.logo} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    // @ts-expect-error — RN doesn't type the web-only transition property
    // but react-native-web forwards it to CSS, giving us a free fade-out
    // without wiring up Animated API.
    transition: `opacity ${FADE_MS}ms ease`,
  },
  logo: {
    width: 600,
    height: 600,
  },
});
