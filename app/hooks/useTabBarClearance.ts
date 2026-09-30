import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pickBottomInset } from '../services/telegram';
import { TAB_BAR_STRIP } from '../constants/sizing';

// How far above the bottom of the VISIBLE screen the floating tab bar's
// top edge sits: the bottom inset the bar itself uses, plus the strip it
// owns (its 58 px and the S.xxl it floats by).
//
// One answer for everyone who has to clear the bar. It used to be worked
// out three ways — the bar used Telegram's inset, profile the raw iOS
// one, tasks an env() probe — which agree in a browser tab and disagree
// inside Telegram, where the iOS inset is not ours to pad for (UX-12.1).
//
// Measured from the visible edge, so it does NOT include the installed
// PWA's root overshoot (hooks/usePwaInsetOvershoot.ts). Something laid
// out from the root's bottom edge adds that on top; something measured
// against window.innerHeight does not.
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return pickBottomInset(insets.bottom) + TAB_BAR_STRIP;
}
