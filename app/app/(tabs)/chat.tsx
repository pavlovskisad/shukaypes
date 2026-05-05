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
            return '🔍 starting search…';
          case 'highlight_spot':
            setSelectedSpot(action.args.spotId);
            router.push('/');
            return '📍 showing spot…';
          case 'walk': {
            // Same flow the radial menu's walk leaf runs — pick a
            // destination from spots+parks via planWalk, fetch a
            // walking polyline, set it on the store. Routes the user
            // to the map so the polyline is visible.
            const { userPosition: pos, spots: ctxSpots, parks: ctxParks } =
              useGameStore.getState();
            if (!pos) return '🚶 need your location first';
            const candidates = buildCandidates(ctxSpots, ctxParks);
            if (candidates.length === 0) return '🚶 no nearby spots yet';
            const plan = planWalk({
              candidates,
              origin: pos,
              shape: action.args.shape,
              distance: action.args.distance,
            });
            if (!plan) return '🚶 nothing at that distance';
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
              return '🚶 couldn\'t plot that route';
            }
            router.push('/');
            return `🚶 walking to ${plan.primary.name}`;
          }
          case 'walk_to_spot': {
            // Companion picked a specific spot from the CONTEXT it was
            // shown — look it up in the gameStore (the same source of
            // truth that built the request), plot a real walking route
            // there, route the user to the map.
            const { userPosition: pos, spots: ctxSpots } = useGameStore.getState();
            if (!pos) return '🚶 need your location first';
            const target = ctxSpots.find((s) => s.id === action.args.spotId);
            if (!target) return '🚶 lost track of that spot — try again';
            const waypoints =
              action.args.shape === 'roundtrip'
                ? [pos, target.position, pos]
                : [pos, target.position];
            const route = await fetchWalkingRoute(pos, waypoints);
            if (!route) return '🚶 couldn\'t plot that route';
            useGameStore.getState().setWalkRoute(route, {
              shape: action.args.shape,
              spotId: target.id,
            });
            recordRecentDestination(target.id);
            router.push('/');
            return `🚶 walking to ${target.name}`;
          }
          default:
            return null;
        }
      } catch {
        return null;
      }
    },
    [startQuest, setSelectedSpot, router],
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
          const res = await api.sendChat('', userPosition, buildSpotsPayload(), true);
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
  }, [userPosition]);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length, typing]);

  const send = useCallback(async () => {
    const t = draft.trim();
    if (!t || sending) return;
    setDraft('');
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: t,
      mode: 'active',
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setSending(true);
    setTyping(true);
    try {
      const res = await api.sendChat(t, userPosition, buildSpotsPayload());
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
          content: `*sniff sniff* — can't reach the walk right now (${(err as Error).message})`,
          mode: 'active',
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
      setTyping(false);
    }
  }, [draft, sending, userPosition, dispatchAction]);

  const header = useMemo(() => companionName || 'шукайпес', [companionName]);

  const insets = useSafeAreaInsets();
  // Padding the scroll content reserves an empty band at top + bottom
  // so the first/last bubbles can scroll freely behind the floating
  // header + input cards (which sit on top of the scroll view as
  // frosted overlays). Numbers approximate the cards' on-screen
  // heights — generous so multi-line names/inputs don't overlap.
  const topPad = insets.top + HEADER_BAND_HEIGHT + 8;
  // insets.bottom covers iOS PWA standalone — the tab bar grows to
  // include the home-indicator safe-area, so the last bubble must sit
  // above (TAB_BAR_HEIGHT + safe-area + input band) to scroll free.
  const bottomPad = TAB_BAR_HEIGHT + insets.bottom + INPUT_BAND_HEIGHT + 8;

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
          clear the home indicator. Without it, the input slides under
          the dashboard. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.bottomBandWrap, { bottom: TAB_BAR_HEIGHT + insets.bottom }]}
        pointerEvents="box-none"
      >
        <View style={styles.bottomBand} pointerEvents="box-none">
          <View style={styles.inputCard} pointerEvents="auto">
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={`talk to ${header}…`}
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

// Approximate visible heights for the floating pills. Used as scroll
// content padding so the first/last bubble can scroll past each pill
// without ever sitting flush against it.
const HEADER_BAND_HEIGHT = 56;   // compact pill + its top/bottom margins
const INPUT_BAND_HEIGHT = 70;    // inputCard + its top/bottom band padding
const TAB_BAR_HEIGHT = 60;       // matches _layout.tsx tabBarStyle
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
    ...CARD_SHADOW,
  },
  // Logo lives inside a small white pill so it reads as a brand
  // chip distinct from the companion-name text.
  headerLogoPill: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLogo: {
    width: 18,
    height: 18,
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
    gap: 8,
  },
  bubble: {
    maxWidth: '82%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderBottomLeftRadius: 6,
    ...CARD_SHADOW,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: ACCENT_BLUE,
    borderBottomRightRadius: 6,
    ...CARD_SHADOW,
  },
  bubbleText: {
    fontFamily: SYSTEM_FONT,
    fontSize: 15,
    lineHeight: 22,
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
  inputCard: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    marginHorizontal: 16,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
    borderRadius: 26,
    ...CARD_SHADOW,
  },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    // 16px keeps iOS Safari from auto-zooming on focus. Anything < 16
    // triggers the zoom and never zooms back out cleanly.
    fontSize: 16,
    fontFamily: SYSTEM_FONT,
    color: colors.black,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
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
