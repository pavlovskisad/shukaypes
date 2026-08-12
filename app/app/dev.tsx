// The door to the test affordances, in a production build, on a real
// phone.
//
// `?sim=1`, `?terrReset=1` and `?terrRaid=1` are off in a shipped build
// (see constants/devTools.ts). This screen turns them on for THIS browser
// after the shared dev password is checked server-side.
//
// Deliberately in English and deliberately plain: nobody but us should
// ever see it, and dressing it up as part of the game would make it look
// like something a tester was meant to find. It is unstyled the way an
// operator tool should be — if it starts looking like a feature, somebody
// will treat it as one.
//
// The password is never in the bundle. It is typed here, verified against
// a Fly secret, then kept in this browser's localStorage with a two-week
// expiry and sent as a header on the two routes that destroy something.

import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { api } from '../services/api';
import { DEV_TOOLS } from '../constants/devTools';
import { clearDevKey, storeDevKey } from '../services/devUnlock';

type Status = 'idle' | 'checking' | 'wrong' | 'error';

export default function DevUnlock() {
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  const submit = async () => {
    if (!password || status === 'checking') return;
    setStatus('checking');
    try {
      await api.unlockDev(password);
    } catch (err) {
      // A wrong password comes back 403; anything else is the network or
      // the server, and telling the two apart matters when you are stood
      // outside on cellular wondering which one you are fighting.
      const message = err instanceof Error ? err.message : '';
      setStatus(/403|nope/.test(message) ? 'wrong' : 'error');
      return;
    }
    storeDevKey(password);
    // Full reload rather than a navigation: DEV_TOOLS is read once at
    // module init, so the flag only changes on a fresh boot of the app.
    try {
      window.location.href = '/';
    } catch {
      router.replace('/');
    }
  };

  const lock = () => {
    clearDevKey();
    try {
      window.location.reload();
    } catch {
      setStatus('idle');
    }
  };

  if (DEV_TOOLS) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>dev tools: ON</Text>
        <Text style={styles.body}>
          ?sim=1 walk simulator, ?terrReset=1 wipe own territory, ?terrRaid=1 raid own
          mark. Append to any URL.
        </Text>
        <Pressable style={styles.button} onPress={lock} accessibilityRole="button">
          <Text style={styles.buttonText}>lock this browser</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>dev tools</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={(t) => {
          setPassword(t);
          if (status !== 'idle') setStatus('idle');
        }}
        onSubmitEditing={submit}
        placeholder="password"
        placeholderTextColor="#8A867C"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
      />
      <Pressable style={styles.button} onPress={submit} accessibilityRole="button">
        <Text style={styles.buttonText}>
          {status === 'checking' ? 'checking…' : 'unlock'}
        </Text>
      </Pressable>
      {status === 'wrong' ? <Text style={styles.error}>wrong password</Text> : null}
      {status === 'error' ? (
        <Text style={styles.error}>could not reach the server — try again</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    backgroundColor: '#F3F0E7',
  },
  title: { fontSize: 20, marginBottom: 18, color: '#2B2B26' },
  body: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    color: '#5A5750',
    marginBottom: 8,
  },
  input: {
    width: '100%',
    maxWidth: 320,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CFC9BA',
    backgroundColor: '#FFFFFF',
    color: '#2B2B26',
    fontSize: 16,
  },
  button: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 999,
    backgroundColor: '#2B2B26',
  },
  buttonText: { color: '#F3F0E7', fontSize: 15 },
  error: { marginTop: 14, fontSize: 13, color: '#A2452F' },
});
