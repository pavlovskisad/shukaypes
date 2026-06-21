import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Splash } from '../components/ui/Splash';
import { notifyTelegramReady } from '../services/telegram';
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

  return (
    // GestureHandlerRootView is required at the tree root for
    // react-native-gesture-handler to receive events on web — the
    // Tinder-style card stack on the tasks tab won't pan without it.
    // flex:1 so the rest of the layout fills the viewport as before.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
        <Splash />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
