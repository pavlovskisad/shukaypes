import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { R } from '../../constants/radius';
import { S } from '../../constants/spacing';
import { HERO } from '../../constants/sizing';
import { Icon, type IconName } from '../../components/ui/Icon';
import { pickBottomInset } from '../../services/telegram';
import { usePwaInsetOvershoot } from '../../hooks/usePwaInsetOvershoot';
import { useStrings } from '../../i18n/useStrings';

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
          position: 'absolute',
          left: S.l,
          right: S.l,
          // Hover the bar above the home-indicator strip with a
          // small visual gap so it reads as a floating pill, not
          // a docked bar. insets.bottom respects the iOS home
          // indicator; the extra S.s puts a breathing gap between
          // the pill and the indicator (or screen edge on
          // Android / TG Mini App where insets.bottom is 0).
          // Bottom margin matches side margins (S.l) so the pill
          // has even breathing room on all three visible sides.
          // + pwaOvershoot compensates the extended installed-PWA root.
          bottom: insets.bottom + pwaOvershoot + S.l,
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
