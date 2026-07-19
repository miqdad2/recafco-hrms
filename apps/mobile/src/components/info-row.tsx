import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../lib/theme';

interface InfoRowProps {
  label: string;
  value: string;
}

export function InfoRow({ label, value }: InfoRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.bgMuted,
  },
  label: { fontSize: 13, color: colors.textSecondary },
  value: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
});
