import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { SYSTEM_FONT } from '../../constants/fonts';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { INK, SURFACE } from '../../constants/surface';
import { popPressableEvent } from '../../utils/popOnTap';
import { pickBottomInset } from '../../services/telegram';
import { usePwaInsetOvershoot } from '../../hooks/usePwaInsetOvershoot';
import { useGameStore } from '../../stores/gameStore';
import { recordRecentDestination } from '../../utils/walk';
import { startExplorationWalk } from '../../services/exploreWalk';
import { fetchWalkingRoute } from '../../services/directions';
import { api, type CompanionAction, type ChatNearbySpot } from '../../services/api';
import { distanceMeters } from '../../utils/geo';
import type { ChatMessage } from '@shukajpes/shared';
import { useStrings } from '../../i18n/useStrings';
import { useLangStore } from '../../stores/langStore';
import { useAccessStore } from '../../stores/accessStore';
import { HandDrawnFrame } from '../../components/ui/HandDrawn';

const URL_RE = /(https?:\/\/[^\s]+)/g;


// A chat action that puts something on the map (a walk, a selected
// spot) has to leave the cold-start gate first. setAppMode is the
// clear-slate reducer: left in 'gate', the user's answer to the ring
// when they reach the map would wipe the walk they just asked for.
// Only when the door is open — an unanswered auth question is not ours
// to skip. The ring 'explore' opens is closed again: the user asked for
// one specific thing, not the walking verbs. Same rule in spots.tsx.
function leaveGateForAction() {
  const s = useGameStore.getState();
  if (s.appMode !== 'gate' || useAccessStore.getState().door !== 'open') return;
  s.setAppMode('explore');
  s.setMenuOpen(false);
}

// Open the map only if the user is still in the chat. An action can land
// seconds after the reply was requested; by then they may be on another
// tab, and yanking them to the map from there is a surprise. The effect
// is on the map either way and waits for them.
function goToMapIfStillHere(router: ReturnType<typeof useRouter>) {
  if (useGameStore.getState().currentScreen === 'chat') router.push('/');
}

function linkify(text: string): Array<{ kind: 'text' | 'link'; value: string }> {
  const parts: Array<{ kind: 'text' | 'link'; value: string }> = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ kind: 'text', value: text.slice(last, i) });
    parts.push({ kind: 'link', value: m[0] });
    last = i + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) });
  return parts;
}

export default function ChatScreen() {
  const t = useStrings();
  const lang = useLangStore((s) => s.lang);
  const router = useRouter();
  const userPosition = useGameStore((s) => s.userPosition);
  const startQuest = useGameStore((s) => s.startQuest);
  const setSelectedSpot = useGameStore((s) => s.setSelectedSpot);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [bootError, setBootError] = useState(false);
  // Bumped by the retry under the boot failure bubble; the boot effect
  // re-runs on it and on nothing else.
  const [bootAttempt, setBootAttempt] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const bootedRef = useRef(false);

  // Dispatch a structured action attached to the assistant's reply.
  // Each branch calls the same gameStore action the radial menu /
  // lost-pet modal would, then routes to the map so the user actually
  // sees the result. Errors are swallowed — the assistant's text
  // already landed; an action failure shouldn't poison the chat.
  const dispatchAction = useCallback(
    async (action: CompanionAction): Promise<string | null> => {
      try {
        switch (action.name) {
          case 'start_quest': {
            // startQuest never throws — a refusal or no GPS comes back as
            // a null quest. Saying "starting search" and opening the map
            // on that showed a search that did not exist.
            if (!useGameStore.getState().userPosition) return `🔍 ${t.chat.needLocation}`;
            const { quest } = await startQuest(action.args.dogId);
            if (!quest) return `🔍 ${t.chat.couldntStartSearch}`;
            goToMapIfStillHere(router);
            return `🔍 ${t.chat.startingSearch}`;
          }
          case 'highlight_spot': {
            // The id comes from the model. If the map has no such spot
            // there is nothing to show, so say so rather than open a map
            // with no selection on it.
            const exists = useGameStore
              .getState()
              .spots.some((s) => s.id === action.args.spotId);
            if (!exists) return `📍 ${t.chat.lostTrackOfSpot}`;
            leaveGateForAction();
            setSelectedSpot(action.args.spotId);
            goToMapIfStillHere(router);
            return `📍 ${t.chat.showingSpot}`;
          }
          case 'walk': {
            // Same flow the radial menu's walk leaf runs — a small local
            // tour out of our own tables. Note it takes parks, not
            // spots: 'walk_to_spot' below is the action for going to a
            // named business, and this one is for wandering.
            const { userPosition: pos, parks: ctxParks } = useGameStore.getState();
            if (!pos) return `🚶 ${t.chat.needLocation}`;
            const walk = await startExplorationWalk({
              origin: pos,
              parks: ctxParks,
              // Always a roundtrip — the shape choice is gone from the
              // menu and from this action's args alike.
              shape: 'roundtrip',
              distance: action.args.distance,
            });
            if (!walk) return `🚶 ${t.chat.couldntPlotRoute}`;
            leaveGateForAction();
            useGameStore.getState().setWalkRoute(
              walk.route,
              {
                shape: 'roundtrip',
                spotId: null,
                destinationName: walk.primary.name,
              },
              walk.stops,
            );
            goToMapIfStillHere(router);
            return walk.stops.length
              ? `🚶 ${t.chat.walkingToVia(walk.primary.name, walk.stops.length)}`
              : `🚶 ${t.chat.walkingTo(walk.primary.name)}`;
          }
          case 'walk_to_spot': {
            // Companion picked a specific spot from the CONTEXT it was
            // shown — look it up in the gameStore (the same source of
            // truth that built the request), plot a real walking route
            // there, route the user to the map.
            const { userPosition: pos, spots: ctxSpots } = useGameStore.getState();
            if (!pos) return `🚶 ${t.chat.needLocation}`;
            const target = ctxSpots.find((s) => s.id === action.args.spotId);
            if (!target) return `🚶 ${t.chat.lostTrackOfSpot}`;
            const waypoints =
              action.args.shape === 'roundtrip'
                ? [pos, target.position, pos]
                : [pos, target.position];
            const route = await fetchWalkingRoute(pos, waypoints);
            if (!route) return `🚶 ${t.chat.couldntPlotRoute}`;
            leaveGateForAction();
            useGameStore.getState().setWalkRoute(route, {
              shape: action.args.shape,
              spotId: target.id,
            });
            recordRecentDestination(target.id);
            goToMapIfStillHere(router);
            return `🚶 ${t.chat.walkingTo(target.name)}`;
          }
          default:
            return null;
        }
      } catch {
        return null;
      }
    },
    [startQuest, setSelectedSpot, router, t],
  );

  useFocusEffect(
    useCallback(() => {
      useGameStore.getState().setScreen('chat');
    }, []),
  );

  // Build the closest-spots payload sent with each chat call. Cap at
  // 8 — the prompt grows the longer this list, and the companion's
  // pick accuracy doesn't improve much beyond that. Returns null when
  // there's no GPS or no spots loaded yet, so sendChat omits the field.
  const buildSpotsPayload = useCallback((): ChatNearbySpot[] | null => {
    const { userPosition: pos, spots } = useGameStore.getState();
    if (!pos || spots.length === 0) return null;
    return spots
      .map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        distM: distanceMeters(pos, s.position),
      }))
      .sort((a, b) => a.distM - b.distM)
      .slice(0, 8);
  }, []);

  // Runs once per mount (and again on retry). Position and language are
  // read from the stores INSIDE the run, not taken as deps: with them as
  // deps, a GPS fix or a language toggle mid-boot cancelled the only run
  // while bootedRef kept a second one from starting — the history never
  // loaded and the typing dots stayed up until a reload. `cancelled` is
  // for unmount only now.
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const { messages: history } = await api.getChatHistory();
        if (cancelled) return;
        setMessages(history);
        if (history.length === 0) {
          setTyping(true);
          const res = await api.sendChat(
            '',
            useGameStore.getState().userPosition,
            buildSpotsPayload(),
            true,
            useGameStore.getState().viewportCenter,
            useLangStore.getState().lang,
          );
          if (cancelled) return;
          setMessages([
            {
              id: res.id,
              role: 'assistant',
              content: res.text,
              mode: 'active',
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      } catch (err) {
        // Detail to the console; the page gets the dog's line and a
        // retry, not the raw exception text.
        // eslint-disable-next-line no-console
        console.warn('[chat] boot failed', err);
        if (!cancelled) setBootError(true);
      } finally {
        if (!cancelled) setTyping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootAttempt, buildSpotsPayload]);

  const retryBoot = useCallback(() => {
    bootedRef.current = false;
    setBootError(false);
    setBootAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length, typing]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      mode: 'active',
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setSending(true);
    setTyping(true);
    let res: Awaited<ReturnType<typeof api.sendChat>>;
    try {
      res = await api.sendChat(
        text,
        userPosition,
        buildSpotsPayload(),
        false,
        useGameStore.getState().viewportCenter,
        lang,
      );
    } catch (err) {
      // The detail goes where a developer will read it, not into the
      // dog's speech bubble — see the note on cantReachWalk in strings.
      // The message never reached the dog, so it comes back out of the
      // transcript and into the composer, to be sent again as it was.
      // eslint-disable-next-line no-console
      console.warn('[chat] send failed', err);
      setMessages((m) => [
        ...m.filter((x) => x.id !== optimistic.id),
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: t.chat.cantReachDog,
          mode: 'active',
          createdAt: new Date().toISOString(),
        },
      ]);
      setDraft((d) => (d ? d : text));
      setSending(false);
      setTyping(false);
      return;
    }
    try {
      setMessages((m) => [
        ...m,
        {
          id: res.id,
          role: 'assistant',
          content: res.text,
          mode: 'active',
          createdAt: new Date().toISOString(),
        },
      ]);
      // If the companion attached an action, dispatch it. The
      // gameStore mutation + router.push happen first; then we
      // surface a tiny system bubble so the user knows something
      // happened (the action's effect is on a different tab).
      if (res.action) {
        const note = await dispatchAction(res.action);
        if (note) {
          setMessages((m) => [
            ...m,
            {
              id: `act-${Date.now()}`,
              role: 'assistant',
              content: note,
              mode: 'active',
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      }
    } catch (err) {
      // The reply already landed; only the action behind it failed. That
      // is the walk (or search) not being reachable, which is what
      // cantReachWalk says. The user's message stays — it was delivered.
      // eslint-disable-next-line no-console
      console.warn('[chat] action failed', err);
      setMessages((m) => [
        ...m,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: t.chat.cantReachWalk(),
          mode: 'active',
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
      setTyping(false);
    }
  }, [draft, sending, userPosition, dispatchAction, t, lang, buildSpotsPayload]);


  const iosInsets = useSafeAreaInsets();
  // In TG Mini App, TG handles the home-indicator strip. Using iOS's
  // bottom inset there double-pads the chat input wrap so it floats
  // too far above the tab bar. Pick TG's bottom inset when present.
  const insets = { ...iosInsets, bottom: pickBottomInset(iosInsets.bottom) };
  // Installed-PWA root is extended down by the bottom inset so the world
  // bleeds through the home-indicator strip; everything anchored to the
  // bottom adds this overshoot to stay clear of the indicator. 0 in
  // browser / TG. See hooks/usePwaInsetOvershoot.ts.
  const safeBottom = insets.bottom + usePwaInsetOvershoot();
  // Padding the scroll content reserves an empty band at top + bottom
  // so the first/last bubbles can scroll freely behind the floating
  // header + input cards (which sit on top of the scroll view as
  // frosted overlays). Numbers approximate the cards' on-screen
  // heights — generous so multi-line names/inputs don't overlap.
  // Extra +24 at top so the first message sits with real air below
  // the header pill instead of pressed against it.
  const topPad = insets.top + HEADER_BAND_HEIGHT + 24;
  // insets.bottom covers iOS PWA standalone — the tab bar grows to
  // include the home-indicator safe-area, so the last bubble must sit
  // above (TAB_BAR_HEIGHT + safe-area + input band) to scroll free.
  const bottomPad =
    TAB_BAR_HEIGHT + safeBottom + INPUT_GAP_ABOVE_TABS + INPUT_BAND_HEIGHT + 72;

  return (
    <View style={styles.root}>
      {/* Scroll fills the entire screen — header + input bands sit on
          top as overlays so bubbles slide under their frosted bg
          instead of being shoved by sibling layout. */}
      <ScrollView
        ref={scrollRef}
        style={StyleSheet.absoluteFill}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: topPad, paddingBottom: bottomPad },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Boot failure: the dog says it, in the user's language, and
            the retry sits under it. Boot only fails with the transcript
            still empty, so this goes first — where the first message
            would have been — and anything sent afterwards lands below
            it in order instead of above it. */}
        {bootError ? (
          <>
            <Bubble
              msg={{
                id: 'boot-error',
                role: 'assistant',
                content: t.chat.cantReachDog,
                mode: 'active',
                createdAt: '',
              }}
            />
            <Pressable
              style={styles.retryBtn}
              onPress={retryBoot}
              onPressIn={popPressableEvent}
              accessibilityRole="button"
            >
              <HandDrawnFrame radius={R.pill} />
              <Text style={styles.retryText}>{t.chat.retry}</Text>
            </Pressable>
          </>
        ) : null}
        {messages.map((m) => (
          <Bubble key={m.id} msg={m} />
        ))}
        {typing ? <TypingIndicator /> : null}
      </ScrollView>

      {/* One fade strip, at the bottom. The top one is gone: there is
          no chrome up there for a message to dissolve into any more,
          so all it did was smear the first line of the transcript. */}
      <View
        style={[
          styles.fadeStrip,
          {
            // Spans from the screen bottom all the way up to the
            // TOP of the input area — covers the dashboard pill,
            // the input row (no longer a white pill — see
            // inputCard style), and the gap between them. The
            // fade gives the input its visual separation from
            // the bubbles instead of a stacked white card.
            bottom: 0,
            height:
              TAB_BAR_HEIGHT +
              safeBottom +
              INPUT_GAP_ABOVE_TABS +
              INPUT_BAND_HEIGHT,
            // Mirror of the top — same eased curve.
            backgroundImage: `linear-gradient(to top, ${SURFACE.fill} 0%, ${SURFACE.fill} 35%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0.55) 68%, rgba(255,255,255,0.25) 83%, rgba(255,255,255,0.08) 95%, ${TRANSPARENT_BG} 100%)`,
          } as unknown as object,
        ]}
        pointerEvents="none"
      />

      {/* No masthead. It named a screen you had already navigated to,
          and it was the one thing stopping the transcript from simply
          dissolving into the top fade. The fade above does the whole
          job on its own. */}

      {/* Bottom frosted band — sits just above the dashboard tab bar.
          KAV pushes it up when the keyboard appears on iOS native;
          on web Safari handles its own viewport adjustment. The
          insets.bottom term covers iOS PWA standalone, where the tab
          bar's visible height = TAB_BAR_HEIGHT + safe-area-inset to
          clear the home indicator. INPUT_GAP_ABOVE_TABS guarantees a
          breathing strip between input + dashboard even when the
          safe-area inset is 0 (e.g. inside TG Mini App, where TG owns
          the home-indicator strip). Without it, the input sits flush
          against the tab bar. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[
          styles.bottomBandWrap,
          { bottom: TAB_BAR_HEIGHT + safeBottom + INPUT_GAP_ABOVE_TABS },
        ]}
        pointerEvents="box-none"
      >
        <View style={styles.bottomBand} pointerEvents="box-none">
          <View style={styles.inputCard} pointerEvents="auto">
            {/* The Field recipe (see LostFlowModal): white paper with a
                drawn edge. An <input> cannot hold the SVG that draws
                it, so the paper is this wrapper and the control inside
                is stripped of its own chrome. Bare, it was white on the
                white page — a composer with no visible edge. */}
            <View style={styles.inputPaper}>
              <HandDrawnFrame radius={R.button} />
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder={t.chat.inputPlaceholder}
                placeholderTextColor={colors.greyLight}
                onSubmitEditing={send}
                editable={!sending}
                returnKeyType="send"
                onFocus={() => {
                  // Force the conversation to the bottom on focus
                  // so when the iOS keyboard raises the input pill,
                  // the last bubble doesn't end up sandwiched
                  // against (or behind) the input. Two raf hops:
                  // first to let the keyboard layout settle, second
                  // to scroll once the new viewport height has
                  // taken effect.
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                      scrollRef.current?.scrollToEnd({ animated: true });
                    });
                  });
                }}
              />
            </View>
            <Pressable style={styles.sendBtn} onPress={send} onPressIn={popPressableEvent} disabled={sending}>
              <HandDrawnFrame radius={R.pill} />
              {sending ? (
                // Ink: the button is white paper, and a white spinner on
                // it was invisible — sending looked like nothing happening.
                <ActivityIndicator size="small" color={INK} />
              ) : (
                <Text style={styles.sendBtnText}>→</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Bubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const parts = linkify(msg.content);
  return (
    <View
      style={[
        styles.bubble,
        isUser ? styles.userBubble : styles.assistantBubble,
      ]}
    >
      {/* Drawn edge — only on the user's white bubble. The dog's is ink
          on ink, where a line is nothing. */}
      {isUser ? <HandDrawnFrame radius={R.card} seed={msg.id ?? msg.content} /> : null}
      <Text
        style={[
          styles.bubbleText,
          isUser ? styles.userText : styles.assistantText,
        ]}
      >
        {parts.map((p, i) =>
          p.kind === 'link' ? (
            <Text
              key={i}
              style={[styles.link, isUser ? styles.userText : styles.assistantText]}
              onPress={() => Linking.openURL(p.value).catch(() => {})}
            >
              {p.value}
            </Text>
          ) : (
            <Text key={i}>{p.value}</Text>
          ),
        )}
      </Text>
    </View>
  );
}

function TypingIndicator() {
  const t = useStrings();
  // The shared word, with its own ellipsis taken off: the animated dots
  // below are the ellipsis here.
  const word = t.sniff.sniffing.replace(/(…|\.+)$/, '');
  const [dots, setDots] = useState('.');
  useEffect(() => {
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '.' : d + '.'));
    }, 400);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={[styles.bubble, styles.assistantBubble, styles.typing]}>
      <Text style={[styles.bubbleText, styles.assistantText]}>{word}{dots}</Text>
    </View>
  );
}

const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.06,
  shadowRadius: 12,
  elevation: 2,
} as const;

// Stronger shadow for the floating header + input cards so they
// separate cleanly from the grey chat background. Bubbles keep
// the lighter CARD_SHADOW so they don't all visually compete
// with the chrome.
const CHROME_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.14,
  shadowRadius: 20,
  elevation: 6,
} as const;

// Approximate visible heights for the floating pills. Used as scroll
// content padding so the first/last bubble can scroll past each pill
// without ever sitting flush against it.
// No masthead and no fade up there any more. This is just the gap
// between the status bar and the first message.
const HEADER_BAND_HEIGHT = 8;
const INPUT_BAND_HEIGHT = 70;    // inputCard + its top/bottom band padding
// Visible reserved bottom space = the floating dashboard pill
// (58 px, post-trim) plus the 24 px gap it hovers above the
// home indicator. Inlined to avoid importing a tokens file into
// the styles section; keep in sync with _layout.tsx's
// tabBarStyle.height (58) + bottom: insets.bottom + S.xxl (24).
const TAB_BAR_HEIGHT = 82;
// CSS-friendly transparent value matching the page background so the
// gradient interpolates as alpha-only on the same hue (no shift through
// a tinted intermediate value).
const TRANSPARENT_BG = 'rgba(255,255,255,0)';
// Breathing room between input wrap and the tab bar — used in addition
// to safe-area inset because TG Mini App reports inset.bottom=0.
const INPUT_GAP_ABOVE_TABS = 10;
const styles = StyleSheet.create({
  // WHITE PAPER, like every other surface in the app. The chat sat on
  // grey, which made the dog's ink bubbles read as cards on a table
  // rather than as words on the page — and made the user's white ones
  // the only thing here that WAS a card. The fade strip at the bottom
  // moves with it: it exists to dissolve the transcript into the page,
  // so it has to be the page's colour or it draws a band of its own.
  root: {
    flex: 1,
    backgroundColor: SURFACE.fill,
  },
  bottomBandWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: TAB_BAR_HEIGHT,
    zIndex: 5,
  },
  bottomBand: {
    paddingVertical: S.xs,
  },
  // Fade strip — solid page-bg over the chrome area + a soft
  // gradient zone where bubbles dissolve into the chrome. Sits
  // BELOW the chrome cards (z 5) and ABOVE the scroll content.
  // top / bottom / height / backgroundImage all set inline so the
  // gradient stops can scale with the actual insets.
  fadeStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 3,
  },
  // White header pill with a stronger CHROME_SHADOW so it
  // separates cleanly from the chat background and reads as
  // floating chrome rather than melting into the bubbles below.
  listContent: {
    paddingHorizontal: S.l,
    // paddingTop/paddingBottom are set inline so the bands' on-screen
    // heights (incl. safe-area inset) can drive the value at runtime.
    gap: S.m,
  },
  // Fatter, Gemini-style bubbles — bigger padding, uniform corners
  // (no more "tail" notch), bigger type. borderRadius bumped 24 →
  // 28 to match the modal sheets + card radii — same "round form"
  // family across the app.
  bubble: {
    maxWidth: '85%',
    paddingVertical: S.l,
    paddingHorizontal: S.xl,
    borderRadius: R.card,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: INK,
    borderWidth: 2,
    borderColor: INK,
    ...CARD_SHADOW,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: SURFACE.fill,
    // Drawn edge — see HandDrawnFrame in Bubble.
    ...CARD_SHADOW,
  },
  bubbleText: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.body,
    lineHeight: 24,
  },
  assistantText: {
    color: '#ffffff',
  },
  userText: {
    color: INK,
  },
  link: {
    textDecorationLine: 'underline',
  },
  typing: {
    opacity: 0.85,
  },
  // The retry under the boot failure bubble — same white disc-and-line
  // paper as the send button, sized to its label.
  retryBtn: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: S.xl,
    borderRadius: R.pill,
    backgroundColor: SURFACE.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.body,
    fontWeight: '700',
    color: INK,
  },
  // Input row — no white card backdrop. Just the input + send
  // button floating directly on the fade so it doesn't stack as
  // a second pill above the dashboard. The fade strip beneath
  // (extends from screen bottom up to the input row) is what
  // gives the input visual separation from the bubbles.
  inputCard: {
    flexDirection: 'row',
    gap: S.s,
    alignItems: 'center',
    marginHorizontal: S.l,
    paddingHorizontal: S.m,
    paddingVertical: S.m,
  },
  // White paper with a drawn edge — see the note in the composer.
  inputPaper: {
    flex: 1,
    backgroundColor: SURFACE.fill,
    borderRadius: R.button,
  },
  input: {
    paddingHorizontal: S.l,
    paddingVertical: S.m,
    // 16px keeps iOS Safari from auto-zooming on focus. Anything < 16
    // triggers the zoom and never zooms back out cleanly. Intentional
    // off-scale value — DO NOT migrate to TYPE.body (15).
    fontSize: 16,
    fontFamily: SYSTEM_FONT,
    color: colors.black,
    // RN-Web wires TextInput to <input>, which gets the browser's
    // default focus ring (a blue rectangle on Safari iOS). Suppress
    // it so the input reads as part of the white card chrome instead
    // of a stark form field.
    outlineStyle: 'none',
    outlineWidth: 0,
  } as unknown as object,
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: R.pill,
    backgroundColor: SURFACE.fill,
    // Drawn edge — see HandDrawnFrame in the button.
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {
    color: INK,
    fontSize: TYPE.title,
    fontWeight: '700',
  },
});
