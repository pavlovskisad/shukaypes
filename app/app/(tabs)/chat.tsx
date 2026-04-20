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
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useGameStore } from '../../stores/gameStore';
import { api } from '../../services/api';
import type { ChatMessage } from '@shukajpes/shared';

const URL_RE = /(https?:\/\/[^\s]+)/g;

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
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{header}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      >
        {bootError && <Text style={styles.error}>{bootError}</Text>}
        {messages.map((m) => (
          <Bubble key={m.id} msg={m} />
        ))}
        {typing && <TypingIndicator />}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={`talk to ${header}...`}
          placeholderTextColor={colors.grey}
          onSubmitEditing={send}
          editable={!sending}
          returnKeyType="send"
        />
        <Pressable style={styles.sendBtn} onPress={send} disabled={sending}>
          {sending ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={styles.sendBtnText}>→</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const parts = linkify(msg.content);
  return (
    <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
      <Text style={[styles.bubbleText, isUser ? styles.userText : styles.assistantText]}>
        {parts.map((p, i) =>
          p.kind === 'link' ? (
            <Text
              key={i}
              style={styles.link}
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    paddingTop: 16,
    paddingBottom: 12,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.greyBg,
  },
  headerTitle: {
    fontFamily: fonts.heading,
    fontSize: 22,
    color: colors.black,
  },
  list: { flex: 1 },
  listContent: {
    padding: 14,
    gap: 10,
  },
  bubble: {
    maxWidth: '82%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.greyBg,
    borderBottomLeftRadius: 4,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.black,
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    fontSize: 16,
    lineHeight: 22,
  },
  assistantText: {
    color: colors.black,
    fontFamily: fonts.heading,
    fontSize: 18,
  },
  userText: {
    color: colors.white,
    fontFamily: fonts.body,
  },
  link: {
    textDecorationLine: 'underline',
  },
  typing: {
    opacity: 0.8,
  },
  error: {
    color: colors.red,
    fontSize: 12,
    alignSelf: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: colors.greyBg,
  },
  input: {
    flex: 1,
    backgroundColor: colors.greyBg,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: fonts.body,
    color: colors.black,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {
    color: colors.accent,
    fontSize: 20,
    fontWeight: '600',
  },
});
