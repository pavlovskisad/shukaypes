import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Splash } from '../components/ui/Splash';
import { InviteGate } from '../components/ui/InviteGate';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { ConnectionBanner } from '../components/ui/ConnectionBanner';
import { AboutModal } from '../components/ui/AboutModal';
import { useGameStore } from '../stores/gameStore';
import { useAccessStore } from '../stores/accessStore';
import { notifyTelegramReady } from '../services/telegram';
import { installGlobalCrashHandlers } from '../services/crashReport';
// Reads the one flag and renders the one sheet. Split out so the root
// layout itself does not subscribe to the game store and re-render the
// whole app every time something in it moves.
function AboutSheetHost() {
  const open = useGameStore((s) => s.aboutOpen);
  const setOpen = useGameStore((s) => s.setAboutOpen);
  return <AboutModal open={open} onClose={() => setOpen(false)} />;
}

// Side-effect import — patches RN's Text/TextInput defaults so every
// instance picks up SYSTEM_FONT even when the component author didn't
// add fontFamily to its style. Must be imported once at app root.
import '../utils/patchTextDefaults';

export default function RootLayout() {
  // Tell Telegram we're ready to render — removes the spinner TG
  // shows over the Mini App's iframe and expands the sheet to full
  // height. No-op outside Telegram.
  useEffect(() => {
    notifyTelegramReady();
  }, []);

  // Catches what a React boundary structurally cannot: throws outside
  // the render cycle, and promise rejections nobody handled. Installed
  // in an effect rather than at module scope so it runs once the app is
  // actually mounting, and it is idempotent either way.
  useEffect(() => {
    installGlobalCrashHandlers();
  }, []);

  // Replaces the whole tree rather than overlaying it: with no account
  // there is no map, no dog and no data to sit behind a modal, and a
  // half-rendered app under a message reads as broken rather than
  // closed. False for everybody until INVITE_REQUIRED is switched on
  // server-side, and false forever for anyone who already has an
  // account.
  const inviteRequired = useAccessStore((s) => s.inviteRequired);
  if (inviteRequired) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <InviteGate />
      </SafeAreaProvider>
    );
  }

  return (
    // GestureHandlerRootView is required at the tree root for
    // react-native-gesture-handler to receive events on web — the
    // Tinder-style card stack on the tasks tab won't pan without it.
    // flex:1 so the rest of the layout fills the viewport as before.
    // The boundary sits INSIDE the providers rather than around them:
    // its fallback renders real components, so it needs the same
    // context they do. Wrapping the outside would mean a crash in the
    // tree leaves the fallback without a SafeAreaProvider.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <ErrorBoundary>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
          {/* Above every tab rather than inside the map, because losing
              the network stops the chat and the tasks list too — and it
              sits under the Splash so a cold start is not greeted by a
              warning about a request that has not been made yet. */}
          <ConnectionBanner />
          {/* Hosted at the root, not on the map, because it is opened
              from the profile tab now — the companion's ring no longer
              carries a «?». A sheet mounted inside one tab cannot be
              opened from another. */}
          <AboutSheetHost />
          <Splash />
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
