// Shown when the server refuses to create an account without a valid
// invite code.
//
// This exists because of how the rest of the app fails. Every API error
// is caught and written to `lastSyncError`, which no component reads —
// so without a screen here, an uninvited person would see the map load
// its shell, nothing populate, the dog never appear, and no explanation
// anywhere. Indistinguishable from a broken app, and the one impression
// you cannot take back from somebody you asked to try your beta.
//
// Deliberately a dead end rather than a form: during a closed round
// there is nothing useful for an uninvited visitor to do here, and a
// "enter your code" box invites guessing at other people's codes.
// Somebody who has a code opens their link again and it just works.

import { View, Text, StyleSheet } from 'react-native';
import { useLangStore } from '../../stores/langStore';
import { colors } from '../../constants/colors';
import { INK, SURFACE } from '../../constants/surface';
import { TYPE } from '../../constants/type';

export function InviteGate() {
  const lang = useLangStore((s) => s.lang);
  const uk = lang === 'uk';

  return (
    <View style={styles.wrap}>
      <Text style={styles.emoji}>🐕</Text>
      <Text style={styles.title}>{uk ? 'поки що за запрошенням' : 'invite only, for now'}</Text>
      <Text style={styles.body}>
        {uk
          ? 'шукайпес зараз у закритому тестуванні. якщо у вас є посилання із запрошенням — відкрийте його ще раз.'
          : 'шукайпес is in closed testing right now. if you have an invite link, open it again.'}
      </Text>
      <Text style={styles.hint}>
        {uk ? 'вже маєте акаунт? він працює як завжди.' : 'already have an account? it still works.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    backgroundColor: SURFACE.fill,
  },
  emoji: { fontSize: 56, marginBottom: 18 },
  title: {
    fontSize: TYPE.hero,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
    color: INK,
  },
  body: {
    fontSize: TYPE.body,
    lineHeight: 22,
    textAlign: 'center',
    color: colors.grey,
  },
  hint: {
    fontSize: TYPE.small,
    textAlign: 'center',
    marginTop: 20,
    color: colors.grey,
  },
});
