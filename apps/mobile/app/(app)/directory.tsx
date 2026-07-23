import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../src/lib/theme';

/**
 * No employee-safe directory endpoint exists in the backend yet (confirmed by reading every
 * `@Controller` in apps/api/src — only the admin-gated `/employees` list exists, which this
 * employee-facing screen must never call). Placeholder only, per the task's own explicit
 * fallback instruction — no backend was added or exposed for this unit.
 */
export default function DirectoryScreen() {
  return (
    <View style={styles.screen}>
      <Ionicons name="people-outline" size={48} color={colors.textMuted} />
      <Text style={styles.title}>Directory Coming Soon</Text>
      <Text style={styles.message}>
        A company employee contact directory will be available here in a future update.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgBase, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  message: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
});
