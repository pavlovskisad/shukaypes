// The language switch, as one pill.
//
// ONE pill, not two. Two separate buttons for a two-state choice spend
// a whole extra pill saying what the first one already said. Tapping
// swaps the language, and the pill reads as the one you are NOT in —
// the way a language switch is labelled everywhere else.
//
// It lives in two places now, which is why it is a component rather
// than markup in a screen: the profile's top row, for somebody who is
// already in; and the gate, for somebody who is not. The gate is the
// first screen anybody sees, and until this it was the only screen in
// the app whose language could not be changed — an English speaker met
// a Ukrainian dog asking a Ukrainian question with a Ukrainian form
// behind it, and the toggle that would have fixed that sat behind the
// door they were trying to get through.

import { Pressable, Text, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { colors } from '../../constants/colors';
import { SYSTEM_FONT } from '../../constants/fonts';
import { CHIP } from '../../constants/sizing';
import { S } from '../../constants/spacing';
import { TYPE } from '../../constants/type';
import { popPressableEvent } from '../../utils/popOnTap';
import { useLangStore } from '../../stores/langStore';
import { HandDrawnFrame } from './HandDrawn';

export function LangPill({ style }: { style?: StyleProp<ViewStyle> }) {
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  return (
    <Pressable
      onPress={() => setLang(lang === 'uk' ? 'en' : 'uk')}
      onPressIn={popPressableEvent}
      accessibilityRole="button"
      // Deliberately NOT from the strings table: the label has to be
      // readable by somebody who cannot read the language the app is
      // currently in — which is the whole point of the control.
      accessibilityLabel={lang === 'uk' ? 'Switch to English' : 'Перемкнути на українську'}
      style={({ pressed }) => [pillStyles.pill, style, pressed && { opacity: 0.7 }]}
    >
      <HandDrawnFrame radius={CHIP.height / 2} />
      <Text style={pillStyles.text}>{lang === 'uk' ? 'EN' : 'UA'}</Text>
    </Pressable>
  );
}

// Exported because the «?» pill beside it in the profile is the same
// shape — one definition, so the pair cannot drift apart.
export const pillStyles = StyleSheet.create({
  // Solid white, same shape + chat-style CHROME_SHADOW as the HUD
  // MeterPill / CounterPill in solid mode. The dark night sky behind
  // would tint a translucent pill, so plain white is cleaner.
  pill: {
    height: CHIP.height,
    minWidth: CHIP.height,
    paddingHorizontal: S.m,
    borderRadius: CHIP.height / 2,
    backgroundColor: '#ffffff',
    // Drawn edge — see HandDrawnFrame.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontFamily: SYSTEM_FONT,
    fontSize: TYPE.small,
    fontWeight: '700',
    color: colors.black,
    letterSpacing: 0.5,
  },
});
