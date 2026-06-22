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
  Image,
} from 'react-native';
import logoNose from '../../assets/logo-nose.png';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { SYSTEM_FONT } from '../../constants/fonts';
import { pickBottomInset } from '../../services/telegram';
import { useGameStore } from '../../stores/gameStore';
import {
  buildCandidates,
  planWalk,
  recordRecentDestination,
} from '../../utils/walk';
import { fetchWalkingRoute } from '../../services/directions';
import { api, type CompanionAction, type ChatNearbySpot } from '../../services/api';
import { distanceMeters } from '../../utils/geo';
import type { ChatMessage } from '@shukajpes/shared';
import { useStrings } from '../../i18n/useStrings';
import { useLangStore } from '../../stores/langStore';

const URL_RE = /(https?:\/\/[^\s]+)/g;

const ACCENT_BLUE = 'rgba(0,60,255,0.85)';

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
  const companionName = useGameStore((s) => s.companionName);
  const startQuest = useGameStore((s) => s.startQuest);
  const setSelectedSpot = useGameStore((s) => s.setSelectedSpot);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
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
          case 'start_quest':
            await startQuest(action.args.dogId);
            router.push('/');
            return `🔍 ${t.chat.startingSearch}`;
          case 'highlight_spot':
            setSelectedSpot(action.args.spotId);
            router.push('/');
            return `📍 ${t.chat.showingSpot}`;
          case 'walk': {
            // Same flow the radial menu's walk leaf runs — pick a
            // destination from spots+parks via planWalk, fetch a
            // walking polyline, set it on the store. Routes the user
            // to the map so the polyline is visible.
            const { userPosition: pos, spots: ctxSpots, parks: ctxParks } =
              useGameStore.getState();
            if (!pos) return `🚶 ${t.chat.needLocation}`;
            const candidates = buildCandidates(ctxSpots, ctxParks);
            if (candidates.length === 0) return `🚶 ${t.chat.noNearbySpots}`;
            const plan = planWalk({
              candidates,
              origin: pos,
              shape: action.args.shape,
              distance: action.args.distance,
            });
            if (!plan) return `🚶 ${t.chat.nothingAtDistance}`;
            const spotId = plan.primary.isSpot ? plan.primary.id : null;
            const route = await fetchWalkingRoute(pos, plan.waypoints);
            if (!route && plan.hasReturnDetour && plan.waypoints.length === 3) {
              const fallback = [plan.waypoints[0]!, plan.waypoints[2]!];
              const route2 = await fetchWalkingRoute(pos, fallback);
              if (route2) {
                useGameStore.getState().setWalkRoute(route2, {
                  shape: action.args.shape,
                  spotId,
                });
                recordRecentDestination(plan.primary.id);
              }
            } else if (route) {
              useGameStore.getState().setWalkRoute(route, {
                shape: action.args.shape,
                spotId,
              });
              recordRecentDestination(plan.primary.id);
            } else {
              return `🚶 ${t.chat.couldntPlotRoute}`;
            }
            router.push('/');
            return `🚶 ${t.chat.walkingTo(plan.primary.name)}`;
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
            useGameStore.getState().setWalkRoute(route, {
              shape: action.args.shape,
              spotId: target.id,
            });
            recordRecentDestination(target.id);
            router.push('/');
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
            userPosition,
            buildSpotsPayload(),
            true,
            useGameStore.getState().viewportCenter,
            lang,
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
        if (!cancelled) setBootError((err as Error).message);
      } finally {
        if (!cancelled) setTyping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userPosition, lang]);

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
    try {
      const res = await api.sendChat(
        text,
        userPosition,
        buildSpotsPayload(),
        false,
        useGameStore.getState().viewportCenter,
        lang,
      );
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
      setMessages((m) => [
        ...m,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: t.chat.cantReachWalk((err as Error).message),
          mode: 'active',
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
      setTyping(false);
    }
  }, [draft, sending, userPosition, dispatchAction, t, lang]);

  const header = useMemo(() => companionName || 'шукайпес', [companionName]);

  const iosInsets = useSafeAreaInsets();
  // In TG Mini App, TG handles the home-indicator strip. Using iOS's
  // bottom inset there double-pads the chat input wrap so it floats
  // too far above the tab bar. Pick TG's bottom inset when present.
  const insets = { ...iosInsets, bottom: pickBottomInset(iosInsets.bottom) };
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
    TAB_BAR_HEIGHT + insets.bottom + INPUT_GAP_ABOVE_TABS + INPUT_BAND_HEIGHT + 8;

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
        {bootError ? <Text style={styles.error}>{bootError}</Text> : null}
        {messages.map((m) => (
          <Bubble key={m.id} msg={m} />
        ))}
        {typing ? <TypingIndicator /> : null}
      </ScrollView>

      {/* Fade strips — gradient fully CONTAINED within the
          chrome zones (no extension into the chat area). Top
          strip spans status bar + header pill height, fading
          from greyBg at the screen edge to transparent at the
          chat-facing edge. Bottom strip mirrors. Bubbles
          scrolling into the chrome dissolve gradually over the
          full chrome height; the chat area stays free of any
          fade overlay. Below z-5 chrome, above the scroll. */}
      <View
        style={[
          styles.fadeStrip,
          {
            top: 0,
            height: insets.top + HEADER_BAND_HEIGHT,
            backgroundImage: `linear-gradient(to bottom, ${colors.greyBg} 0%, ${TRANSPARENT_BG} 100%)`,
          } as unknown as object,
        ]}
        pointerEvents="none"
      />
      <View
        style={[
          styles.fadeStrip,
          {
            bottom: TAB_BAR_HEIGHT + insets.bottom,
            height: INPUT_BAND_HEIGHT + INPUT_GAP_ABOVE_TABS,
            backgroundImage: `linear-gradient(to top, ${colors.greyBg} 0%, ${TRANSPARENT_BG} 100%)`,
          } as unknown as object,
        ]}
        pointerEvents="none"
      />

      {/* Top pill — compact companion-handle so it reads as "who
          you're talking to" rather than a hero card. */}
      <View
        style={[styles.topBand, { paddingTop: insets.top }]}
        pointerEvents="box-none"
      >
        <View style={styles.headerCard} pointerEvents="auto">
          <View style={styles.headerLogoPill}>
            <Image source={logoNose} style={styles.headerLogo} resizeMode="contain" />
          </View>
          <Text style={styles.headerTitle}>{header}</Text>
        </View>
      </View>

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
          { bottom: TAB_BAR_HEIGHT + insets.bottom + INPUT_GAP_ABOVE_TABS },
        ]}
        pointerEvents="box-none"
      >
        <View style={styles.bottomBand} pointerEvents="box-none">
          <View style={styles.inputCard} pointerEvents="auto">
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={t.chat.inputPlaceholder}
              placeholderTextColor="#999"
              onSubmitEditing={send}
              editable={!sending}
              returnKeyType="send"
            />
            <Pressable style={styles.sendBtn} onPress={send} disabled={sending}>
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
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
  const [dots, setDots] = useState('.');
  useEffect(() => {
    const t = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '.' : d + '.'));
    }, 400);
    return () => clearInterval(t);
  }, []);
  return (
    <View style={[styles.bubble, styles.assistantBubble, styles.typing]}>
      <Text style={[styles.bubbleText, styles.assistantText]}>sniffing{dots}</Text>
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
const HEADER_BAND_HEIGHT = 56;   // compact pill + its top/bottom margins
const INPUT_BAND_HEIGHT = 70;    // inputCard + its top/bottom band padding
// Mirrors HERO.size from constants/sizing.ts (used by tabBarStyle.height).
// Inlined to avoid importing a tokens file into the styles section.
const TAB_BAR_HEIGHT = 64;
// CSS-friendly transparent value matching colors.greyBg so the
// gradient interpolates as alpha-only on the same hue (no
// shift through grey-tinted intermediate values).
const TRANSPARENT_BG = 'rgba(240,240,240,0)';
// Breathing room between input wrap and the tab bar — used in addition
// to safe-area inset because TG Mini App reports inset.bottom=0.
const INPUT_GAP_ABOVE_TABS = 10;
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.greyBg,
  },
  topBand: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
  },
  bottomBandWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: TAB_BAR_HEIGHT,
    zIndex: 5,
  },
  bottomBand: {
    paddingVertical: 4,
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
  headerCard: {
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
    backgroundColor: '#ffffff',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...CHROME_SHADOW,
  },
  headerLogoPill: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLogo: {
    width: 26,
    height: 26,
  },
  headerTitle: {
    fontFamily: SYSTEM_FONT,
    fontSize: 15,
    fontWeight: '700',
    color: colors.black,
  },
  listContent: {
    paddingHorizontal: 16,
    // paddingTop/paddingBottom are set inline so the bands' on-screen
    // heights (incl. safe-area inset) can drive the value at runtime.
    gap: 12,
  },
  // Fatter, Gemini-style bubbles — bigger padding, uniform corners
  // (no more "tail" notch), bigger type. Reads more comfortable on
  // long replies and matches the chunky-card direction the rest of
  // the app moved to.
  bubble: {
    maxWidth: '85%',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 24,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    ...CARD_SHADOW,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: ACCENT_BLUE,
    ...CARD_SHADOW,
  },
  bubbleText: {
    fontFamily: SYSTEM_FONT,
    fontSize: 16,
    lineHeight: 24,
  },
  assistantText: {
    color: colors.black,
  },
  userText: {
    color: '#ffffff',
  },
  link: {
    textDecorationLine: 'underline',
  },
  typing: {
    opacity: 0.85,
  },
  error: {
    color: '#a33',
    fontSize: 12,
    alignSelf: 'center',
    marginVertical: 8,
  },
  // Fatter input card — bigger paddings + radius to match the
  // chunkier bubble + send-button proportions. CHROME_SHADOW so
  // it floats clearly above the chat background instead of
  // melting into the last bubble above.
  inputCard: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    marginHorizontal: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderRadius: 32,
    ...CHROME_SHADOW,
  },
  input: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    // 16px keeps iOS Safari from auto-zooming on focus. Anything < 16
    // triggers the zoom and never zooms back out cleanly.
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
    borderRadius: 22,
    backgroundColor: ACCENT_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
});
