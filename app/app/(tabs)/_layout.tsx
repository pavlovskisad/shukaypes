import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { colors } from '../../constants/colors';
import { Icon, type IconName } from '../../components/ui/Icon';

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
      <Icon name={name} size={26} />
    </View>
  );
}

export default function TabsLayout() {
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
          bottom: 0,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          backgroundColor: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(18px) saturate(160%)',
          // @ts-expect-error — safari prefix not in RN style types
          WebkitBackdropFilter: 'blur(18px) saturate(160%)',
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
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'map',
          tabBarIcon: ({ focused }) => <TabIcon name="map" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'quests',
          tabBarIcon: ({ focused }) => <TabIcon name="task" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'chat',
          tabBarIcon: ({ focused }) => <TabIcon name="chat" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="spots"
        options={{
          title: 'spots',
          tabBarIcon: ({ focused }) => <TabIcon name="pin" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'home',
          tabBarIcon: ({ focused }) => <TabIcon name="house" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
