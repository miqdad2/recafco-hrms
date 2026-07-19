import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PasswordReminderBanner } from '../../src/components/password-reminder-banner';
import { useAuth } from '../../src/lib/auth/auth-context';
import { NO_EMPLOYEE_MESSAGE } from '../../src/lib/auth/no-employee-message';
import { colors } from '../../src/lib/theme';

interface HomeCard {
  key: string;
  title: string;
  href: string | null;
}

const CARDS: HomeCard[] = [
  { key: 'today-attendance', title: 'Today Attendance', href: '/attendance' },
  { key: 'register-device', title: 'Register Device', href: '/device' },
  { key: 'my-attendance', title: 'My Attendance', href: '/attendance' },
  { key: 'corrections', title: 'Corrections', href: '/corrections' },
];

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const hasEmployee = user?.employeeId != null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <PasswordReminderBanner />

      <Text style={styles.welcome}>Welcome, {user?.username}</Text>

      {hasEmployee ? (
        <Text style={styles.meta}>Employee ID: {user?.employeeId}</Text>
      ) : (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>{NO_EMPLOYEE_MESSAGE}</Text>
        </View>
      )}

      <Text style={styles.meta}>{user?.roles.length ? `Roles: ${user.roles.join(', ')}` : 'No roles assigned'}</Text>
      <Text style={styles.meta}>{user?.permissions.length ?? 0} permissions granted</Text>

      <View style={styles.cardGrid}>
        {CARDS.map((card) => (
          <Pressable
            key={card.key}
            style={({ pressed }) => [
              styles.card,
              !card.href && styles.cardDisabled,
              pressed && card.href ? styles.cardPressed : null,
            ]}
            onPress={() => {
              if (card.href) {
                router.push(card.href);
              }
            }}
            disabled={!card.href}
          >
            <Text style={styles.cardTitle}>{card.title}</Text>
            <Text style={card.href ? styles.cardBadgeActive : styles.cardBadge}>
              {card.href ? 'Tap to open →' : 'Coming soon'}
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgBase },
  container: { padding: 20 },
  welcome: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  meta: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  noticeCard: {
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
  },
  noticeText: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  cardGrid: { marginTop: 24, gap: 12 },
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardDisabled: { opacity: 0.6 },
  cardPressed: { backgroundColor: colors.bgMuted },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  cardBadge: { fontSize: 12, color: colors.warning, marginTop: 6, fontWeight: '600' },
  cardBadgeActive: { fontSize: 12, color: colors.accentPrimary, marginTop: 6, fontWeight: '600' },
});
