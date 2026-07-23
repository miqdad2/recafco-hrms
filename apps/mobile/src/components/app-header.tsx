import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/theme';

interface AppHeaderProps {
  onMenuPress: () => void;
}

/**
 * Replaces the default per-screen native header (via `Tabs`' `screenOptions.header`) with a
 * single consistent RECAFCO-branded header across every screen — menu on the left (opens the
 * side menu), fixed "RECAFCO HRMS" title in the center, notification bell on the right. Because
 * this fully replaces the native header, it must account for the status bar itself via
 * `useSafeAreaInsets` (the native header normally does this automatically).
 */
export function AppHeader({ onMenuPress }: AppHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
      <Pressable onPress={onMenuPress} hitSlop={12} style={styles.iconButton} accessibilityLabel="Open menu">
        <Ionicons name="menu" size={24} color={colors.textPrimary} />
      </Pressable>
      <Text style={styles.title}>RECAFCO HRMS</Text>
      <Pressable
        onPress={() => Alert.alert('Notifications', 'Notifications coming soon.')}
        hitSlop={12}
        style={styles.iconButton}
        accessibilityLabel="Notifications"
      >
        <Ionicons name="notifications-outline" size={22} color={colors.textPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: colors.bgSurface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconButton: { width: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
});
