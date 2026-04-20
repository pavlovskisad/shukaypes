import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../constants/colors';

// Native map lands in Phase 2.5 via react-native-maps.
// Web target ships first per the plan.
export default function MapView() {
  return (
    <View style={styles.root}>
      <Text style={styles.t}>native map lands in phase 2.5</Text>
      <Text style={styles.s}>using expo web for this pilot session</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.greyBg },
  t: { fontSize: 16, color: colors.black },
  s: { fontSize: 12, color: colors.grey, marginTop: 4 },
});
