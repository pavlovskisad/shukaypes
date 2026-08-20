import { useLayoutEffect, useRef, useState } from 'react';
import { Tabs } from 'expo-router';
import { View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { HERO } from '../../constants/sizing';
import { Icon, type IconName } from '../../components/ui/Icon';
import { pickBottomInset } from '../../services/telegram';
import { usePwaInsetOvershoot } from '../../hooks/usePwaInsetOvershoot';
import { useStrings } from '../../i18n/useStrings';
import { useGameStore } from '../../stores/gameStore';

// Same overshoot easing the HUD pills use on the map screen — the two
// surfaces are one piece of chrome and have to move alike.
const POP_IN = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
// How long the bar takes to leave. Also how long it stays mounted after
// being hidden — the two are the same number on purpose.
const POP_OUT_MS = 320;

// Tab icons are pixel-art SVGs (see components/ui/Icon.tsx). Inactive
// tabs read as desaturated/dimmed via a wrapper View — RN-Web passes
// `filter` through to CSS, so the same grayscale recipe we used on
// emoji glyphs still works on the SVG-backed Icon.
function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  return (
    <View
      style={{
        // Pulled inactive opacity 0.55 → 0.32 so the focused tab
        // dominates more obviously. Grayscale stays for the colour
        // strip on top.
        filter: focused ? undefined : 'grayscale(1)',
        opacity: focused ? 1 : 0.32,
      }}
    >
      <Icon name={name} size={HERO.icon} />
    </View>
  );
}

export default function TabsLayout() {
  const t = useStrings();
  // Read the actual bottom safe-area inset (iOS home-indicator
  // height) so we can extend the tab bar's bg into that strip
  // and pad the icons up by the same amount. The previous
  // `paddingBottom: 'env(safe-area-inset-bottom)'` string trick
  // didn't reach Safari through RN's StyleSheet — using the
  // numeric value from the hook is the reliable path.
  const iosInsets = useSafeAreaInsets();
  // In Telegram Mini App, TG manages the home-indicator strip
  // itself — using iOS's inset doubles the padding and pushes the
  // bar's anchor below TG's content area, which is why the dashboard
  // reads as 'too low' in that context.
  const bottomInset = pickBottomInset(iosInsets.bottom);
  const insets = { ...iosInsets, bottom: bottomInset };
  // Installed-PWA root is extended down by the bottom inset (so the world
  // bleeds through the home-indicator strip) — lift the floating bar back
  // up by the same amount so it keeps its gap above the indicator. 0 in
  // browser / TG, where the root isn't extended.
  const pwaOvershoot = usePwaInsetOvershoot();
  // Supersniff hides the dashboard (this floating tab bar) so the map and
  // the lost-dogs carousel get the full screen; it returns when sniff is
  // toggled off via the corner logo. Only ever on the map tab, so this
  // doesn't strand navigation elsewhere.
  const dogCam = useGameStore((s) => s.dogCam);
  // …and the gate hides it for the same reason: while the dog is asking,
  // the four answers are the only navigation there is.
  //
  // Scoped to the map screen, and that scoping is load-bearing. The note
  // above holds for supersniff because supersniff can only be turned on
  // from the map — but the gate is where every cold start BEGINS, on
  // whatever route the browser was left on. Reload while on the chat tab
  // and, unscoped, this would hide the dashboard on a screen that has no
  // dog to tap and no ring to answer: no way back, and the only way out
  // a reload. The ring lives on the map, so the bar only defers to it
  // there.
  const appMode = useGameStore((s) => s.appMode);
  const currentScreen = useGameStore((s) => s.currentScreen);
  const hidden = dogCam || (appMode === 'gate' && currentScreen === 'map');

  // THE BAR USED TO JUST VANISH. `display: none` is not animatable, so
  // for as long as this bar has existed it cut out instantly while the
  // HUD pills beside it bubbled — two halves of one piece of chrome
  // moving on different rules.
  //
  // It animates now, which means it has to outlive `hidden` long enough
  // to play the pop-out. Three states, same shape as the modal family:
  // visible → animating-out (still mounted, `pointerEvents: none` so it
  // cannot take a tap it no longer looks able to take) → gone.
  const [mounted, setMounted] = useState(!hidden);
  const [justChanged, setJustChanged] = useState(false);
  const initRef = useRef(true);
  useLayoutEffect(() => {
    if (initRef.current) {
      initRef.current = false;
      return;
    }
    setJustChanged(true);
    if (!hidden) setMounted(true);
    // Two clocks, deliberately. The bar must disappear the instant its
    // pop-out ends (POP_OUT_MS) — that is the whole window in which a
    // shrinking, half-gone bar could still take a tap, and it is not
    // shortenable any other way (see popAnimation below). Clearing
    // `justChanged` waits the full 700ms, because the pop-in is a 200ms
    // delay plus a 360ms run and dropping its animation early would
    // snap it into place.
    const unmount = hidden
      ? setTimeout(() => setMounted(false), POP_OUT_MS)
      : undefined;
    const settle = setTimeout(() => setJustChanged(false), 700);
    return () => {
      if (unmount) clearTimeout(unmount);
      clearTimeout(settle);
    };
  }, [hidden]);

  // RN's ViewStyle has no `animation` — the HUD pills get away with it
  // because they are raw <div>s, where the DOM's CSS types apply. The
  // tab bar's style goes through RN's typing, and RN-Web hands it to CSS
  // all the same. Same escape hatch the modal family uses to get a
  // `calc()` past `maxHeight: number`.
  //
  // `pointerEvents` is NOT settable here, and it was worth checking
  // rather than assuming: RN-Web drives it from the View prop and drops
  // it from style, and the rendered bar's inline style confirms it —
  // `animation`, `opacity` and `display` all come through, pointer-events
  // does not. React Navigation owns the element, so the prop is out of
  // reach. What bounds the exposure instead is UNMOUNT_MS below: the bar
  // is gone the moment the pop-out ends, and it is scaling toward zero
  // for that whole window.
  const popAnimation = {
    animation: justChanged
      ? hidden
        ? `pop-out ${POP_OUT_MS}ms ease-in forwards`
        : `pop-in 360ms ${POP_IN} 200ms both`
      : 'none',
  } as unknown as ViewStyle;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Slide screens horizontally based on tab order. React Navigation
        // v7's bottom-tabs supports `animation: 'shift'` which translates
        // each screen by its sibling-distance on focus — moves left/right
        // matching the tab strip, looks like a real swipe even though
        // gestures aren't wired.
        animation: 'shift',
        tabBarActiveTintColor: colors.black,
        tabBarInactiveTintColor: colors.grey,
        // Floating pill — the bar sits with margins on all three
        // visible sides (left / right / bottom) instead of bleeding
        // to the screen edges. Full pill radius matches the rest
        // of the app's chip / pill family. Shadow is now a soft
        // all-around lift instead of an upward-only top shadow.
        tabBarStyle: {
          // Only truly gone once the pop-out has finished; until then it
          // is on screen, shrinking, and deaf to taps.
          display: mounted ? 'flex' : 'none',
          opacity: hidden ? 0 : 1,
          transform: hidden ? [{ scale: 0 }] : [{ scale: 1 }],
          ...popAnimation,
          position: 'absolute',
          left: S.l,
          right: S.l,
          // Hover the bar above the home-indicator strip with a
          // small visual gap so it reads as a floating pill, not
          // a docked bar. insets.bottom respects the iOS home
          // indicator; the extra S.s puts a breathing gap between
          // the pill and the indicator (or screen edge on
          // Android / TG Mini App where insets.bottom is 0).
          // Floats a touch higher than the side margins (S.xxl vs S.l)
          // so the pill clears the home indicator with comfortable air
          // below it. + pwaOvershoot compensates the extended
          // installed-PWA root.
          bottom: insets.bottom + pwaOvershoot + S.xxl,
          // 10 % shorter than HERO.size (64 → 58). Explicit
          // pixel value — TAB_BAR_HEIGHT in chat.tsx pairs with
          // this + the bottom inset, keep them in sync.
          height: 58,
          paddingBottom: 0,
          // Full pill radius (capsule) — matches the canonical
          // chip family across the app (HUD pills, chips, etc.).
          // On a 64-tall bar that's 32 px corners → capsule shape.
          borderRadius: R.pill,
          backgroundColor: '#ffffff',
          borderTopWidth: 0,
          // Lifted shadow on all sides (was upward-only since the
          // bar bled to bottom). Centred 8 px offset + soft radius
          // matches the chat input pill / HUD pills.
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.10,
          shadowRadius: 16,
          elevation: 6,
        },
        tabBarItemStyle: {
          paddingVertical: S.s,
        },
        // Hide the text labels under each tab icon — Expo Router /
        // RN-Web's BottomTab renderer keeps them on by default on
        // some platforms (visible in the Telegram Mini App, hidden in
        // Safari), which made the bar feel inconsistent across
        // surfaces. Icons are large enough to carry meaning on their
        // own; `title` still drives screen titles + a11y.
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t.tabs.map,
          tabBarIcon: ({ focused }) => <TabIcon name="map" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: t.tabs.quests,
          tabBarIcon: ({ focused }) => <TabIcon name="task" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: t.tabs.chat,
          tabBarIcon: ({ focused }) => <TabIcon name="chat" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="spots"
        options={{
          title: t.tabs.spots,
          tabBarIcon: ({ focused }) => <TabIcon name="pin" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t.tabs.home,
          tabBarIcon: ({ focused }) => <TabIcon name="house" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
