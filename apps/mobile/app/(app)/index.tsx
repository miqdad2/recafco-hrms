import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PasswordReminderBanner } from '../../src/components/password-reminder-banner';
import { listMyAttendanceSummaries, type AttendanceDailySummary } from '../../src/lib/api/attendance-summaries';
import { ApiError } from '../../src/lib/api/client';
import {
  formatDateTimeForDisplay,
  getCurrentWeekDates,
  getKuwaitTodayDateString,
  kuwaitDateStringFromWorkDate,
} from '../../src/lib/attendance/date-utils';
import { DAILY_ATTENDANCE_STATUS_COPY } from '../../src/lib/attendance/summary-status-copy';
import { useAuth } from '../../src/lib/auth/auth-context';
import { NO_EMPLOYEE_MESSAGE } from '../../src/lib/auth/no-employee-message';
import { colors } from '../../src/lib/theme';

interface QuickLink {
  key: string;
  title: string;
  subtitle: string;
  href: string;
}

const QUICK_LINKS: QuickLink[] = [
  { key: 'device', title: 'Device', subtitle: 'View registration status', href: '/device' },
  { key: 'corrections', title: 'Corrections', subtitle: 'Request or review corrections', href: '/corrections' },
];

/**
 * `/auth/me` (see apps/mobile/src/lib/api/client.ts) returns only `username`/`employeeId`, not a
 * full employee record — no employeeCode/fullName/department/designation. Initials and the
 * greeting name are derived from `username` for now; a future employee-profile endpoint
 * returning those richer fields would let this card show a real name/department instead.
 */
function getInitials(username: string | undefined): string {
  if (!username) {
    return '?';
  }
  return username.slice(0, 2).toUpperCase();
}

export default function HomeScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const hasEmployee = user?.employeeId != null;

  const [summaries, setSummaries] = React.useState<AttendanceDailySummary[] | null>(null);
  const [isLoadingSummaries, setIsLoadingSummaries] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [summariesError, setSummariesError] = React.useState<string | null>(null);

  const loadSummaries = React.useCallback(async () => {
    if (!hasEmployee) {
      setIsLoadingSummaries(false);
      setIsRefreshing(false);
      return;
    }
    setSummariesError(null);
    try {
      const result = await listMyAttendanceSummaries({ limit: 5 });
      setSummaries(result.data);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await logout();
        return;
      }
      setSummariesError(error instanceof ApiError ? error.message : "Could not load today's attendance.");
    } finally {
      setIsLoadingSummaries(false);
      setIsRefreshing(false);
    }
  }, [hasEmployee, logout]);

  // Nested function declared inside the effect (not a call to the outer useCallback above) —
  // same established pattern as device.tsx/attendance.tsx, required to avoid the React
  // Compiler's set-state-in-effect rule. `loadSummaries` above is the reusable path for
  // pull-to-refresh, triggered from an event handler, which this lint rule does not flag.
  React.useEffect(() => {
    let cancelled = false;

    async function loadInitialSummaries() {
      if (!hasEmployee) {
        if (!cancelled) {
          setIsLoadingSummaries(false);
        }
        return;
      }
      setSummariesError(null);
      try {
        const result = await listMyAttendanceSummaries({ limit: 5 });
        if (!cancelled) {
          setSummaries(result.data);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await logout();
          return;
        }
        if (!cancelled) {
          setSummariesError(error instanceof ApiError ? error.message : "Could not load today's attendance.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSummaries(false);
        }
      }
    }

    void loadInitialSummaries();
    return () => {
      cancelled = true;
    };
  }, [hasEmployee, logout]);

  const todayDateString = getKuwaitTodayDateString();
  const todaySummary = React.useMemo(
    () => summaries?.find((summary) => kuwaitDateStringFromWorkDate(summary.workDate) === todayDateString) ?? null,
    [summaries, todayDateString],
  );

  const weekDates = React.useMemo(() => getCurrentWeekDates(), []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    void loadSummaries();
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      refreshControl={
        hasEmployee ? <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} /> : undefined
      }
    >
      <PasswordReminderBanner />

      <View style={styles.greetingCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(user?.username)}</Text>
        </View>
        <View style={styles.greetingTextGroup}>
          <Text style={styles.greetingHello}>Hello,</Text>
          <Text style={styles.greetingName}>{user?.username}</Text>
          {hasEmployee ? <Text style={styles.greetingMeta}>Employee ID: {user?.employeeId}</Text> : null}
          <Text style={styles.greetingMeta}>{user?.roles.length ? user.roles.join(', ') : 'No roles assigned'}</Text>
        </View>
      </View>

      {!hasEmployee ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>{NO_EMPLOYEE_MESSAGE}</Text>
        </View>
      ) : (
        <>
          <View style={styles.leaveRow}>
            <View style={styles.leaveCard}>
              <Text style={styles.leaveTitle}>Annual Leave</Text>
              <Text style={styles.leaveValue}>Coming soon</Text>
            </View>
            <View style={styles.leaveCard}>
              <Text style={styles.leaveTitle}>Sick Leave</Text>
              <Text style={styles.leaveValue}>Coming soon</Text>
            </View>
          </View>

          <View style={styles.weekStrip}>
            {weekDates.map((day) => (
              <View key={day.dateString} style={[styles.weekDay, day.isToday && styles.weekDayToday]}>
                <Text style={[styles.weekDayLabel, day.isToday && styles.weekDayLabelToday]}>{day.dayLabel}</Text>
                <Text style={[styles.weekDayNumber, day.isToday && styles.weekDayNumberToday]}>{day.dayNumber}</Text>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Today</Text>
            <Text style={styles.shiftText}>Shift: Coming soon</Text>
            {isLoadingSummaries ? (
              <ActivityIndicator color={colors.accentPrimary} style={styles.spinner} />
            ) : summariesError ? (
              <Text style={styles.errorText}>{summariesError}</Text>
            ) : todaySummary ? (
              <>
                <View style={styles.statusRow}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: DAILY_ATTENDANCE_STATUS_COPY[todaySummary.status].tone },
                    ]}
                  />
                  <Text style={styles.statusLabel}>{DAILY_ATTENDANCE_STATUS_COPY[todaySummary.status].label}</Text>
                </View>
                <Text style={styles.punchMeta}>Check In: {formatDateTimeForDisplay(todaySummary.officialInTime)}</Text>
                <Text style={styles.punchMeta}>Check Out: {formatDateTimeForDisplay(todaySummary.officialOutTime)}</Text>
              </>
            ) : (
              <Text style={styles.statusMessage}>No daily summary calculated yet.</Text>
            )}
            <Pressable
              style={({ pressed }) => [styles.linkButton, pressed && styles.linkButtonPressed]}
              onPress={() => router.push('/attendance')}
            >
              <Text style={styles.linkButtonText}>Go to Attendance →</Text>
            </Pressable>
          </View>

          <View style={styles.quickGrid}>
            {QUICK_LINKS.map((link) => (
              <Pressable
                key={link.key}
                style={({ pressed }) => [styles.quickCard, pressed && styles.quickCardPressed]}
                onPress={() => router.push(link.href)}
              >
                <Text style={styles.quickCardTitle}>{link.title}</Text>
                <Text style={styles.quickCardSubtitle}>{link.subtitle}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgBase },
  container: { padding: 20 },
  greetingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accentPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  greetingTextGroup: { flex: 1 },
  greetingHello: { fontSize: 13, color: colors.textSecondary },
  greetingName: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  greetingMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  noticeCard: {
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  noticeText: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  leaveRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  leaveCard: {
    flex: 1,
    backgroundColor: colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  leaveTitle: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  leaveValue: { fontSize: 15, fontWeight: '700', color: colors.textMuted, marginTop: 6 },
  weekStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    marginBottom: 16,
  },
  weekDay: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 6, borderRadius: 10, flex: 1 },
  weekDayToday: { backgroundColor: colors.accentPrimary },
  weekDayLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  weekDayLabelToday: { color: '#fff' },
  weekDayNumber: { fontSize: 14, color: colors.textPrimary, fontWeight: '700', marginTop: 2 },
  weekDayNumberToday: { color: '#fff' },
  section: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 },
  shiftText: { fontSize: 12, color: colors.textMuted, marginBottom: 10 },
  spinner: { marginVertical: 8 },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 18 },
  statusMessage: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  punchMeta: { fontSize: 13, color: colors.textSecondary },
  linkButton: { marginTop: 10, alignSelf: 'flex-start' },
  linkButtonPressed: { opacity: 0.6 },
  linkButtonText: { color: colors.accentPrimary, fontSize: 13, fontWeight: '600' },
  quickGrid: { flexDirection: 'row', gap: 12 },
  quickCard: {
    flex: 1,
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickCardPressed: { backgroundColor: colors.bgMuted },
  quickCardTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  quickCardSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
});
