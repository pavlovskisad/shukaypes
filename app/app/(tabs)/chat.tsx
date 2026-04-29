import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
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
import { useGameStore } from '../../stores/gameStore';
import { api } from '../../services/api';
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
  const userPosition = useGameStore((s) => s.userPosition);
  const companionName = useGameStore((s) => s.companionName);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const bootedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      useGameStore.getState().setScreen('chat');
    }, []),
  );

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
          const res = await api.sendChat('', userPosition, true);
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
      const res = await api.sendChat(t, userPosition);
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
  }, [draft, sending, userPosition]);

  const header = useMemo(() => companionName || 'шукайпес', [companionName]);

  const insets = useSafeAreaInsets();
  // Padding the scroll content reserves an empty band at top + bottom
  // so the first/last bubbles can scroll freely behind the floating
  // header + input cards (which sit on top of the scroll view as
  // frosted overlays). Numbers approximate the cards' on-screen
  // heights — generous so multi-line names/inputs don't overlap.
  const topPad = insets.top + HEADER_BAND_HEIGHT + 8;
  const bottomPad = TAB_BAR_HEIGHT + INPUT_BAND_HEIGHT + 8;

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

      {/* Top frosted band — covers the safe-area inset + header pill so
          messages scrolling up disappear under it cleanly. */}
      <View
        style={[styles.topBand, { paddingTop: insets.top }]}
        pointerEvents="box-none"
      >
        <View style={styles.headerCard} pointerEvents="auto">
          <Text style={styles.headerTitle}>{header}</Text>
          <Text style={styles.headerSub}>chat</Text>
        </View>
      </View>

      {/* Bottom frosted band — sits just above the dashboard tab bar.
          KAV pushes it up when the keyboard appears on iOS native;
          on web Safari handles its own viewport adjustment. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.bottomBandWrap}
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

// Approximate visible heights for the floating bands. Used as scroll
// content padding so the first/last bubble can scroll past the band's
// frosted bg without ever sitting flush against it.
const HEADER_BAND_HEIGHT = 80;   // headerCard + its margins
const INPUT_BAND_HEIGHT = 70;    // inputCard + its top/bottom band padding
const TAB_BAR_HEIGHT = 60;       // matches _layout.tsx tabBarStyle

// Translucent backdrop matching the dashboard tab bar recipe so the
// header + input bands feel part of the same family. Bubbles sliding
// under read as frosted-glass occlusion, not hard cuts.
const FROSTED_BG = {
  backgroundColor: 'rgba(245,245,245,0.85)',
  backdropFilter: 'blur(18px) saturate(160%)',
  WebkitBackdropFilter: 'blur(18px) saturate(160%)',
} as const;

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
    paddingBottom: 8,
    zIndex: 5,
    ...FROSTED_BG,
  },
  bottomBandWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: TAB_BAR_HEIGHT,
    zIndex: 5,
  },
  bottomBand: {
    paddingVertical: 8,
    ...FROSTED_BG,
  },
  headerCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    ...CARD_SHADOW,
  },
  headerTitle: {
    fontFamily: SYSTEM_FONT,
    fontSize: 20,
    fontWeight: '700',
    color: colors.black,
  },
  headerSub: {
    fontFamily: SYSTEM_FONT,
    fontSize: 12,
    color: '#777',
    marginTop: 2,
    textTransform: 'lowercase',
    letterSpacing: 0.3,
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
