import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../src/lib/auth/auth-context';
import { NO_EMPLOYEE_MESSAGE } from '../../src/lib/auth/no-employee-message';
import { colors } from '../../src/lib/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);
  const hasEmployee = user?.employeeId != null;

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.section}>
        <Text style={styles.label}>Username</Text>
        <Text style={styles.value}>{user?.username}</Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{user?.email ?? '—'}</Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.label}>Employee Profile</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: hasEmployee ? colors.success : colors.warning }]} />
          <Text style={styles.value}>{hasEmployee ? `Linked (${user?.employeeId})` : 'Not Linked'}</Text>
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.label}>Roles</Text>
        <Text style={styles.value}>{user?.roles.join(', ') || 'None'}</Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.label}>Permissions</Text>
        <Text style={styles.value}>{user?.permissions.length ?? 0} granted</Text>
      </View>

      {!hasEmployee ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>{NO_EMPLOYEE_MESSAGE}</Text>
        </View>
      ) : null}

      <Pressable
        style={({ pressed }) => [styles.changePasswordButton, pressed && styles.changePasswordButtonPressed]}
        onPress={() => router.push('/change-password')}
      >
        <Text style={styles.changePasswordText}>Change Password</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.logoutButton, pressed && styles.logoutButtonPressed]}
        onPress={handleLogout}
        disabled={isLoggingOut}
      >
        {isLoggingOut ? <ActivityIndicator color={colors.error} /> : <Text style={styles.logoutText}>Sign Out</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgBase },
  container: { padding: 20 },
  section: {
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 12,
  },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 4, fontWeight: '600' },
  value: { fontSize: 16, color: colors.textPrimary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  noticeCard: {
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  noticeText: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  changePasswordButton: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.bgSurface,
  },
  changePasswordButtonPressed: { backgroundColor: colors.bgMuted },
  changePasswordText: { color: colors.accentPrimary, fontSize: 16, fontWeight: '600' },
  logoutButton: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutButtonPressed: { backgroundColor: '#fef2f2' },
  logoutText: { color: colors.error, fontSize: 16, fontWeight: '600' },
});
