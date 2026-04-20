import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView from '../../components/map';
import { StatusBar } from '../../components/ui/StatusBar';
import { useGameStore } from '../../stores/gameStore';

export default function MapScreen() {
  useFocusEffect(useCallback(() => {
    useGameStore.getState().setScreen('map');
  }, []));

  return (
    <View style={styles.root}>
      <View style={styles.mapLayer}>
        <MapView />
      </View>
      <SafeAreaView style={styles.hud} pointerEvents="box-none" edges={['top']}>
        <View style={styles.statusBarWrap}>
          <StatusBar />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  mapLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  hud: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  statusBarWrap: {
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
});
