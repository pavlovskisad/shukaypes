import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../constants/colors';
import { HERO } from '../../constants/sizing';
import { Icon, type IconName } from '../../components/ui/Icon';
import { pickBottomInset } from '../../services/telegram';
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
        // Frosted-glass dashboard flush to the bottom edge with rounded
        // top corners — pill shape on top, full-bleed on the bottom so
        // it reads as a "drawer pulled up from the floor". Family
        // shadow recipe (softer, lifted upward).
        tabBarStyle: {
          position: 'absolute',
          left: 0,
          right: 0,
          // Shift the bar's anchor DOWN by the bottom inset so its bg
          // extends INTO the home-indicator strip; the matching
          // `paddingBottom` pads the icons back up so they don't sit
          // under the indicator. Without the negative `bottom` offset
          // the bar's anchor sits at the TOP of the safe-area strip
          // (the screen container respects the inset by default), so
          // adding paddingBottom alone just made the bar taller upward
          // and left the strip below uncovered.
          bottom: -insets.bottom,
          // Explicit height. Default Expo BottomTab shrinks when
          // `tabBarShowLabel: false` is set, which broke the chat
          // input's `bottom: TAB_BAR_HEIGHT + insets.bottom + …`
          // offset (chat constant is 64; the bar was rendering at
          // ~50, leaving a visible empty strip between the input and
          // the dashboard in the TG Mini App). Locking it here pairs
          // with TAB_BAR_HEIGHT in chat.tsx — keep them in sync.
          height: HERO.size + insets.bottom,
          paddingBottom: insets.bottom,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          // Plain white — the previous frosted-glass treatment
          // picked up tints from whatever was behind the bar
          // (dark night sky on profile, map colours on home) and
          // read as greyish. Solid white is cleaner across all
          // tabs.
          backgroundColor: '#ffffff',
          borderTopWidth: 0,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 12,
          elevation: 4,
        },
        tabBarItemStyle: {
          paddingVertical: 6,
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
