import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../constants/colors';
import { useGameStore } from '../../stores/gameStore';

export default function ChatScreen() {
  useFocusEffect(useCallback(() => {
    useGameStore.getState().setScreen('chat');
  }, []));
  return (
    <View style={styles.root}>
      <Text style={styles.title}>chat</Text>
      <Text style={styles.placeholder}>phase 4: claude chat + ambient</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    color: colors.black,
  },
  placeholder: {
    fontSize: 12,
    color: colors.grey,
    marginTop: 8,
  },
});
