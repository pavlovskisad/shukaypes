// The last thing between a render throw and a blank white page.
//
// There was no boundary anywhere in this app. Any component that threw
// during render unmounted the entire tree, and since there is no service
// worker and no persisted game state, the only way back was for the user
// to work out on their own that they should reload. Four such incidents
// are on record — every one of them a hook-order mistake that shipped.
//
// Written as a class because React error boundaries have no hook
// equivalent; this is the only class component in the codebase.
//
// DEPENDS ON ALMOST NOTHING, on purpose. It does not read the language
// store, or any store — the thing that just crashed may well be the
// store, and a fallback that throws while rendering the fallback gives
// you a blank page with extra steps. Language comes straight from
// localStorage with a default, and the styles are literals.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { reportCrash } from '../../services/crashReport';

interface Props {
  children: ReactNode;
}

interface State {
  crashed: boolean;
}

function isUkrainian(): boolean {
  try {
    const raw = window.localStorage.getItem('shukajpes.lang');
    // zustand/persist wraps the value: {"state":{"lang":"uk"},"version":0}
    return raw ? !/"lang":"en"/.test(raw) : true;
  } catch {
    return true; // Kyiv pilot default.
  }
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // componentStack is far more useful than the stack itself on a
    // minified bundle — it names the component tree that broke.
    reportCrash('render', error, info.componentStack?.slice(0, 1500) ?? undefined);
  }

  private reload = (): void => {
    try {
      window.location.reload();
    } catch {
      // Native, or a browser that refuses. Clearing the flag at least
      // re-attempts a render, which is better than a dead button.
      this.setState({ crashed: false });
    }
  };

  render(): ReactNode {
    if (!this.state.crashed) return this.props.children;
    const uk = isUkrainian();

    return (
      <View style={styles.wrap}>
        <Text style={styles.emoji}>🐕‍🦺</Text>
        <Text style={styles.title}>{uk ? 'ой. щось зламалось' : 'oh. something broke'}</Text>
        <Text style={styles.body}>
          {uk
            ? 'ми вже знаємо про це — звіт надіслано. спробуйте перезавантажити.'
            : 'we already know — a report was sent. try reloading.'}
        </Text>
        <Pressable style={styles.button} onPress={this.reload} accessibilityRole="button">
          <Text style={styles.buttonText}>{uk ? 'перезавантажити' : 'reload'}</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    backgroundColor: '#F3F0E7',
  },
  emoji: { fontSize: 56, marginBottom: 18 },
  title: { fontSize: 22, textAlign: 'center', marginBottom: 12, color: '#2B2B26' },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center', color: '#5A5750' },
  button: {
    marginTop: 26,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 999,
    backgroundColor: '#2B2B26',
  },
  buttonText: { color: '#F3F0E7', fontSize: 15 },
});
