import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../constants/colors';

export default function MapScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.placeholder}>map</Text>
      <Text style={styles.sub}>phase 2: b&w map + companion overlay</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.greyBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: {
    fontSize: 24,
    color: colors.black,
  },
  sub: {
    fontSize: 12,
    color: colors.grey,
    marginTop: 6,
  },
});
