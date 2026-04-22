import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '../../constants/colors';

function TabIcon({ icon, focused }: { icon: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{icon}</Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.black,
        tabBarInactiveTintColor: colors.grey,
        // Frosted-glass dashboard floating over the map. position:absolute
        // so the map extends to the bottom of the screen and its footer
        // is covered by the translucent bar.
        tabBarStyle: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(255,255,255,0.65)',
          // Web-only; react-native-web passes through to CSS.
          backdropFilter: 'blur(18px) saturate(160%)',
          // @ts-expect-error — safari prefix not in RN style types
          WebkitBackdropFilter: 'blur(18px) saturate(160%)',
          borderTopColor: 'rgba(26,26,26,0.08)',
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
          title: 'tasks',
          tabBarIcon: ({ focused }) => <TabIcon icon="✓" focused={focused} />,
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
