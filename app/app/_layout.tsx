import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Splash } from '../components/ui/Splash';
import { useGameStore } from '../stores/gameStore';

// Sniff mode is implemented as an app-wide CSS `filter: invert(1)
// hue-rotate(180deg)` applied to <body>. That's the classic "lazy
// dark mode" / "sunglasses" trick — a single GPU shader on the root
// element flips lightness across the whole UI (map tiles, HUD
// pills, dashboard, modals — everything). Way cheaper than swapping
// Google Maps' style rules at runtime (which had to re-render every
// tile on every toggle), and no per-marker filter management
// either. The hue-rotate(180deg) keeps colours close to their
// original hue after the lightness flip so reds stay reddish, etc.
// — without it, an invert turns red into cyan.
//
// Trade-off: pet photos in lost-pet markers display as photo
// negatives in sniff mode. The user accepts this — sniff mode is
// the "everything covered until you turn it off" view.
export default function RootLayout() {
  const sniffMode = useGameStore((s) => s.sniffMode);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const body = document.body;
    body.style.transition = 'filter 220ms ease-out';
    body.style.filter = sniffMode ? 'invert(1) hue-rotate(180deg)' : '';
    return () => {
      body.style.filter = '';
    };
  }, [sniffMode]);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
      <Splash />
    </SafeAreaProvider>
  );
}
