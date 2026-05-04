import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Splash } from '../components/ui/Splash';

// On desktop browsers, wrap the whole app in a phone-shaped frame so
// reviewers / casual visitors see the actual mobile layout instead of
// a fluid stretched-to-1920px version (which looks broken because the
// product is mobile-first: HUD pills sized for thumbs, modals pinned
// to the bottom edge, etc). On mobile, the frame disappears and the
// app fills the viewport as before.
//
// Frame dimensions match an iPhone 14 (390×844). The body's existing
// overflow:hidden CSS keeps the page itself from scrolling — only the
// inner ScrollView surfaces respond to wheel input.
//
// All modals and overlays in the app use position:absolute + inset:0
// already, so they fill the phone frame correctly because the phone
// wrapper is position:relative.

const DESKTOP_MIN_WIDTH = 900;

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`).matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}

export default function RootLayout() {
  const isDesktop = useIsDesktop();

  const app = (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
      <Splash />
    </SafeAreaProvider>
  );

  if (!isDesktop) return app;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background:
          'radial-gradient(ellipse at center, #2a2a35 0%, #15151a 70%, #0a0a0d 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Outer bezel — dark phone-body around the screen. The inner
          rounded corners on the screen sit nested inside this. */}
      <div
        style={{
          position: 'relative',
          width: 390,
          height: 'min(844px, calc(100vh - 60px))',
          background: '#0e0e12',
          borderRadius: 48,
          padding: 8,
          boxShadow:
            '0 25px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06) inset, 0 0 0 1px rgba(0,0,0,0.4)',
        }}
      >
        {/* Inner screen — position:relative so the app's modals,
            HUD, and dashboard (all position:absolute + inset:0)
            anchor to the phone bounds, not the viewport. */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            background: '#ffffff',
            borderRadius: 40,
            overflow: 'hidden',
          }}
        >
          {app}
        </div>
      </div>
    </div>
  );
}
