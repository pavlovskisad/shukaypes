import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '../../constants/colors';

function TabIcon({ icon, focused }: { icon: string; focused: boolean }) {
  return (
    <Text
      style={{
        fontSize: 22,
        // Inactive tabs read as b&w — grayscale strips the color from
        // emoji glyphs (RN Web passes `filter` through to CSS), opacity
        // softens them further so the focused tab visibly pops.
        filter: focused ? undefined : 'grayscale(1)',
        opacity: focused ? 1 : 0.55,
      }}
    >
      {icon}
    </Text>
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
          tabBarIcon: ({ focused }) => <TabIcon icon="🗺️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'quests',
          tabBarIcon: ({ focused }) => <TabIcon icon="🎯" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'chat',
          tabBarIcon: ({ focused }) => <TabIcon icon="💬" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="spots"
        options={{
          title: 'spots',
          tabBarIcon: ({ focused }) => <TabIcon icon="📍" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'profile',
          tabBarIcon: ({ focused }) => <TabIcon icon="👤" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
