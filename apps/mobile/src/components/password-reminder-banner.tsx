import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../lib/auth/auth-context';
import { colors } from '../lib/theme';

const LATER_DELAY_MS = 2 * 60 * 1000;

export function PasswordReminderBanner() {
  const { user } = useAuth();
  const router = useRouter();
  const [dismissedAt, setDismissedAt] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (dismissedAt === null) {
      return;
    }
    const timer = setTimeout(() => setDismissedAt(null), LATER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dismissedAt]);

  if (!user?.mustChangePassword || dismissedAt !== null) {
    return null;
  }

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>You are using a temporary password. Please change it for security.</Text>
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => router.push('/change-password')}
        >
          <Text style={styles.buttonText}>Change Password</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.laterButton, pressed && styles.laterButtonPressed]} onPress={() => setDismissedAt(Date.now())}>
          <Text style={styles.laterText}>Later</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  text: { fontSize: 14, color: colors.textPrimary, lineHeight: 20, marginBottom: 10 },
  actions: { flexDirection: 'row', gap: 10 },
  button: {
    backgroundColor: colors.accentPrimary,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  buttonPressed: { backgroundColor: colors.accentPrimaryHover },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  laterButton: { paddingVertical: 8, paddingHorizontal: 14 },
  laterButtonPressed: { opacity: 0.6 },
  laterText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
});
