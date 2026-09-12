import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Splash } from '../components/ui/Splash';
import { InviteGate } from '../components/ui/InviteGate';
import { AccountDoor } from '../components/ui/AccountDoor';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { ConnectionBanner } from '../components/ui/ConnectionBanner';
import { AboutModal } from '../components/ui/AboutModal';
import { useGameStore } from '../stores/gameStore';
import { useAccessStore } from '../stores/accessStore';
import { notifyTelegramReady } from '../services/telegram';
import { installGlobalCrashHandlers } from '../services/crashReport';
import { ApiError, auth, type Me } from '../services/api';
import { clearAccount, scrubLinkFromUrl, takeResetToken, takeVerifyToken } from '../services/account';
import { clearSession } from '../services/session';

// THE DOOR'S KEEPER (D-69). Asks the server who this account is and
// whether it is through — once at boot, again whenever a refused
// request nudges — and consumes the tokens a mail link brought:
// ?verify= confirms the address (and logs this device in), ?reset=
// opens the new-password screen. Lives in a hook rather than in the
// door component because the door is not mounted while the answer is
// 'open', and the question still has to be asked.
// The mail-link half runs ONCE, outside the re-read below, and its
// result is applied unconditionally: the game loop's first refused
// requests nudge a re-read within the same second, and an effect
// cleanup that dropped the in-flight verification left the person
// looking at «ми знайомі?» with a login already stored.
let linkFlight: Promise<void> | null = null;

function useDoorKeeper(): void {
  const nudge = useAccessStore((s) => s.doorNudge);
  const setMe = useAccessStore((s) => s.setMe);
  const assumeOpen = useAccessStore((s) => s.assumeOpen);
  const setResetToken = useAccessStore((s) => s.setResetToken);
  const setDoorNotice = useAccessStore((s) => s.setDoorNotice);
  const openDoorSheet = useAccessStore((s) => s.openDoorSheet);

  useEffect(() => {
    let cancelled = false;
    if (!linkFlight) {
      linkFlight = (async () => {
        const verify = takeVerifyToken();
        const reset = takeResetToken();
        if (reset) {
          setResetToken(reset);
          openDoorSheet('reset');
        }
        scrubLinkFromUrl();
        if (!verify) return;
        try {
          setMe(await auth.verify(verify));
        } catch {
          // Spent or expired: the ordinary read below draws the door,
          // and the person is told why they are looking at it.
          setDoorNotice('linkExpired');
        }
        // Again, now that expo-router has settled its initial route —
        // it can rewrite the address after the first scrub and put the
        // spent token back, and a reload would then say "link expired"
        // to somebody who is already through.
        scrubLinkFromUrl();
      })();
    }
    (async () => {
      await linkFlight;
      let me = await auth.me().catch((err: unknown) => err);
      // The slip or login names an account that no longer exists (the
      // fresh-start wipe, or a deleted account): forget both and ask
      // again as a bare device, which mints a new row and meets the
      // door. Without this the 404 read as "server unreachable" and
      // the app assumed itself open — through the gate with every
      // other request refused.
      if (me instanceof ApiError && me.status === 404) {
        clearSession();
        clearAccount();
        me = await auth.me().catch(() => null);
      }
      if (cancelled) return;
      if (me && !(me instanceof Error)) setMe(me as Me);
      else assumeOpen();
    })();
    return () => {
      cancelled = true;
    };
    // `nudge` is the trigger: a 403 from any route re-reads /auth/me.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nudge]);
}
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

  // Take down the shell's CSS-only splash (public/index.html, #splash)
  // now that React is drawing. It exists for the seconds before this
  // bundle had downloaded and parsed; from here the React <Splash>
  // underneath owns the hand-off. Runs on both branches below, so the
  // invite door is not left under a wordmark. A no-op everywhere but
  // web, and on a page that never had one.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.getElementById('splash')?.remove();
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
  useDoorKeeper();
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
          {/* The account sheet (D-69). Self-gating: draws nothing until
              the dog's «ми знайомі?» is answered at the gate, a mail
              link opened the app, or the account is waiting on its
              verification link. Over the map, never instead of it. */}
          <AccountDoor />
          <Splash />
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
