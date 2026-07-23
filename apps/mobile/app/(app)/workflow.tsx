import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { listMyAttendanceCorrections, type AttendanceCorrection } from '../../src/lib/api/attendance-corrections';
import { ApiError } from '../../src/lib/api/client';
import { CORRECTION_STATUS_COPY, CORRECTION_TYPE_LABELS } from '../../src/lib/attendance/correction-status-copy';
import { formatDateForDisplay } from '../../src/lib/attendance/date-utils';
import { useAuth } from '../../src/lib/auth/auth-context';
import { NO_EMPLOYEE_MESSAGE } from '../../src/lib/auth/no-employee-message';
import { colors } from '../../src/lib/theme';

interface WorkflowCounts {
  pending: number;
  draft: number;
  approved: number;
  rejected: number;
}

export default function WorkflowScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const hasEmployee = user?.employeeId != null;

  const [corrections, setCorrections] = React.useState<AttendanceCorrection[] | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!hasEmployee) {
        setIsLoading(false);
        return;
      }
      setError(null);
      try {
        const result = await listMyAttendanceCorrections({ limit: 50 });
        setCorrections(result.data);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await logout();
          return;
        }
        if (!options.silent) {
          setError(err instanceof ApiError ? err.message : 'Could not load workflow requests.');
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [hasEmployee, logout],
  );

  React.useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      if (!hasEmployee) {
        if (!cancelled) {
          setIsLoading(false);
        }
        return;
      }
      setError(null);
      try {
        const result = await listMyAttendanceCorrections({ limit: 50 });
        if (!cancelled) {
          setCorrections(result.data);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await logout();
          return;
        }
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load workflow requests.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, [hasEmployee, logout]);

  // Draft has no backend concept yet — attendance corrections are created PENDING immediately,
  // there is no intermediate unsaved-draft state, so this stays a fixed 0 rather than a guess.
  const counts: WorkflowCounts = React.useMemo(() => {
    const list = corrections ?? [];
    return {
      pending: list.filter((correction) => correction.status === 'PENDING').length,
      draft: 0,
      approved: list.filter((correction) => correction.status === 'APPROVED').length,
      rejected: list.filter((correction) => correction.status === 'REJECTED').length,
    };
  }, [corrections]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    void load();
  };

  if (!hasEmployee) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
        <Text style={styles.pageTitle}>Workflow</Text>
        <View style={[styles.section, styles.noticeCard]}>
          <Text style={styles.noticeText}>{NO_EMPLOYEE_MESSAGE}</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
    >
      <Text style={styles.pageTitle}>Workflow</Text>

      <View style={styles.countGrid}>
        <View style={styles.countCard}>
          <Text style={styles.countValue}>{counts.pending}</Text>
          <Text style={styles.countLabel}>Pending</Text>
        </View>
        <View style={styles.countCard}>
          <Text style={styles.countValue}>{counts.draft}</Text>
          <Text style={styles.countLabel}>Draft</Text>
        </View>
        <View style={styles.countCard}>
          <Text style={styles.countValue}>{counts.approved}</Text>
          <Text style={styles.countLabel}>Approved</Text>
        </View>
        <View style={styles.countCard}>
          <Text style={styles.countValue}>{counts.rejected}</Text>
          <Text style={styles.countLabel}>Rejected</Text>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [styles.newRequestButton, pressed && styles.newRequestButtonPressed]}
        onPress={() => router.push('/corrections')}
      >
        <Text style={styles.newRequestButtonText}>Request Attendance Correction</Text>
      </Pressable>

      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Recent Requests</Text>
          <Pressable onPress={handleRefresh} disabled={isRefreshing || isLoading}>
            <Text style={styles.refreshLink}>{isRefreshing ? 'Refreshing…' : 'Refresh'}</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.accentPrimary} style={styles.spinner} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : !corrections || corrections.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No requests available</Text>
            <Text style={styles.emptyMessage}>We didn&apos;t find any requests.</Text>
          </View>
        ) : (
          corrections.slice(0, 10).map((correction) => (
            <Pressable
              key={correction.id}
              style={({ pressed }) => [styles.requestRow, pressed && styles.requestRowPressed]}
              onPress={() => router.push('/corrections')}
            >
              <View style={styles.requestRowHeader}>
                <Text style={styles.requestDate}>{formatDateForDisplay(correction.workDate)}</Text>
                <View style={styles.statusRow}>
                  <View
                    style={[styles.statusDot, { backgroundColor: CORRECTION_STATUS_COPY[correction.status].tone }]}
                  />
                  <Text style={styles.statusLabel}>{CORRECTION_STATUS_COPY[correction.status].label}</Text>
                </View>
              </View>
              <Text style={styles.requestType}>{CORRECTION_TYPE_LABELS[correction.correctionType]}</Text>
            </Pressable>
          ))
        )}
      </View>

      <View style={[styles.section, styles.comingSoonSection]}>
        <Text style={styles.sectionTitle}>Leave &amp; Documents</Text>
        <Text style={styles.comingSoonText}>Leave requests and document requests are coming soon.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgBase },
  container: { padding: 20 },
  pageTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 16 },
  section: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 10 },
  noticeCard: { backgroundColor: '#fffbeb' },
  noticeText: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  countGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  countCard: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    alignItems: 'center',
  },
  countValue: { fontSize: 24, fontWeight: '800', color: colors.accentPrimary },
  countLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '600', marginTop: 2 },
  newRequestButton: {
    backgroundColor: colors.accentPrimary,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  newRequestButtonPressed: { backgroundColor: colors.accentPrimaryHover },
  newRequestButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  refreshLink: { color: colors.accentPrimary, fontSize: 13, fontWeight: '600' },
  spinner: { marginVertical: 8 },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 18 },
  emptyState: { alignItems: 'center', paddingVertical: 20 },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  emptyMessage: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  requestRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  requestRowPressed: { backgroundColor: colors.bgMuted },
  requestRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  requestDate: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  requestType: { fontSize: 13, color: colors.textSecondary },
  comingSoonSection: { backgroundColor: colors.bgMuted, borderStyle: 'dashed' },
  comingSoonText: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
});
