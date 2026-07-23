import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../lib/auth/auth-context';
import { colors } from '../lib/theme';

interface SideMenuProps {
  visible: boolean;
  onClose: () => void;
}

interface MenuItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href?: string;
  comingSoon?: boolean;
}

const MENU_ITEMS: MenuItem[] = [
  { key: 'profile', label: 'Profile', icon: 'person-outline', href: '/profile' },
  { key: 'device', label: 'Device', icon: 'phone-portrait-outline', href: '/device' },
  { key: 'change-password', label: 'Change Password', icon: 'key-outline', href: '/change-password' },
  { key: 'payslip', label: 'Payslip', icon: 'document-text-outline', comingSoon: true },
  { key: 'documents', label: 'Documents', icon: 'folder-outline', comingSoon: true },
  { key: 'assets', label: 'Assets', icon: 'cube-outline', comingSoon: true },
  { key: 'important-links', label: 'Important Links', icon: 'link-outline', comingSoon: true },
  { key: 'change-language', label: 'Change Language', icon: 'language-outline', comingSoon: true },
];

/**
 * A plain `Modal` slide-over rather than a real drawer library (e.g. `@react-navigation/drawer`)
 * — no new native dependency is justified for a simple, rarely-open side panel, matching this
 * project's established "don't add a heavy library for something a plain component can do"
 * precedent (Units 15/17/19). Uses a fade-in rather than a horizontal slide transition for the
 * same reason: simplest thing that works, documented rather than silently simplified.
 */
export function SideMenu({ visible, onClose }: SideMenuProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);

  const handleItemPress = (item: MenuItem) => {
    if (item.comingSoon) {
      Alert.alert(item.label, `${item.label} is coming soon.`);
      return;
    }
    onClose();
    if (item.href) {
      router.push(item.href);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      onClose();
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.panel, { paddingTop: insets.top + 16 }]} onPress={(event) => event.stopPropagation()}>
          <ScrollView contentContainerStyle={styles.panelContent}>
            <Text style={styles.panelTitle}>RECAFCO HRMS</Text>

            {MENU_ITEMS.map((item) => (
              <Pressable
                key={item.key}
                style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                onPress={() => handleItemPress(item)}
              >
                <Ionicons name={item.icon} size={20} color={colors.textSecondary} style={styles.itemIcon} />
                <Text style={styles.itemLabel}>{item.label}</Text>
                {item.comingSoon ? <Text style={styles.comingSoonTag}>Coming soon</Text> : null}
              </Pressable>
            ))}

            <Pressable
              style={({ pressed }) => [styles.item, styles.logoutItem, pressed && styles.itemPressed]}
              onPress={handleLogout}
              disabled={isLoggingOut}
            >
              <Ionicons name="log-out-outline" size={20} color={colors.error} style={styles.itemIcon} />
              {isLoggingOut ? (
                <ActivityIndicator color={colors.error} size="small" />
              ) : (
                <Text style={styles.logoutLabel}>Logout</Text>
              )}
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(15, 23, 42, 0.4)' },
  panel: {
    width: '78%',
    maxWidth: 320,
    backgroundColor: colors.bgSurface,
    height: '100%',
  },
  panelContent: { paddingHorizontal: 20, paddingBottom: 24 },
  panelTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: 20 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.bgMuted,
  },
  itemPressed: { backgroundColor: colors.bgMuted },
  itemIcon: { marginRight: 14 },
  itemLabel: { fontSize: 15, color: colors.textPrimary, fontWeight: '600', flex: 1 },
  comingSoonTag: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  logoutItem: { marginTop: 12, borderBottomWidth: 0 },
  logoutLabel: { fontSize: 15, color: colors.error, fontWeight: '700' },
});
