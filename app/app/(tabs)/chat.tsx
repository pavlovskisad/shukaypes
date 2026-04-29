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
import { SafeAreaView } from 'react-native-safe-area-context';
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

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header card — matches the profile family. Companion name +
            small "chat" subtitle so the screen has the same "title in
            card" anchor as the others. */}
        <View style={styles.headerCard}>
          <Text style={styles.headerTitle}>{header}</Text>
          <Text style={styles.headerSub}>chat</Text>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        >
          {bootError ? <Text style={styles.error}>{bootError}</Text> : null}
          {messages.map((m) => (
            <Bubble key={m.id} msg={m} />
          ))}
          {typing ? <TypingIndicator /> : null}
        </ScrollView>

        {/* Input row floats as its own card just above the floating tab
            bar. Same shadow/radius recipe as the rest of the family. */}
        <View style={styles.inputCard}>
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
      </KeyboardAvoidingView>
    </SafeAreaView>
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.greyBg,
  },
  flex: { flex: 1 },
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
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
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
    marginBottom: 70, // sit just above the tab bar with a small gap
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
