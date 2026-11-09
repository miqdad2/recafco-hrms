import { useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  createMobilePunch,
  listMyAttendancePunches,
  type AttendanceRawPunch,
} from '../../src/lib/api/attendance-punches';
import {
  createPunchAttempt,
  isOutcomeUnknown,
  reusablePunchAttempt,
  type PunchAttempt,
} from '../../src/lib/attendance/punch-attempt';
import { listMyAttendanceSummaries, type AttendanceDailySummary } from '../../src/lib/api/attendance-summaries';
import { ApiError } from '../../src/lib/api/client';
import { getMyMobileDevices, type MobileDevice } from '../../src/lib/api/mobile-devices';
import { InfoRow } from '../../src/components/info-row';
import {
  formatDateForDisplay,
  formatDateTimeForDisplay,
  formatMinutesAsHours,
  formatWeekdayForDisplay,
  getKuwaitTodayDateString,
  kuwaitDateStringFromWorkDate,
} from '../../src/lib/attendance/date-utils';
import {
  officialFlagLabel,
  PUNCH_VALIDATION_STATUS_COPY,
  SOURCE_TYPE_LABELS,
} from '../../src/lib/attendance/punch-status-copy';
import { DAILY_ATTENDANCE_STATUS_COPY } from '../../src/lib/attendance/summary-status-copy';
import { useAuth } from '../../src/lib/auth/auth-context';
import { NO_EMPLOYEE_MESSAGE } from '../../src/lib/auth/no-employee-message';
import { getDeviceIdentifier } from '../../src/lib/device/device-identifier';
import { getDeviceInfo } from '../../src/lib/device/device-info';
import { MOBILE_DEVICE_STATUS_COPY } from '../../src/lib/device/device-status-copy';
import {
  getCurrentLocation,
  getForegroundPermissionStatus,
  requestForegroundPermission,
  MAX_ACCEPTABLE_ACCURACY_METERS,
  type LocationPermissionStatus,
  type LocationReading,
} from '../../src/lib/location/location-service';
import { colors } from '../../src/lib/theme';

type PunchResultMessage = { type: 'success' | 'warning' | 'error'; text: string };

function describePunchResult(punch: AttendanceRawPunch): PunchResultMessage {
  const copy = PUNCH_VALIDATION_STATUS_COPY[punch.validationStatus];
  const action = punch.punchType === 'IN' ? 'Check In' : 'Check Out';
  const type: PunchResultMessage['type'] = punch.validationStatus.startsWith('REJECTED')
    ? 'error'
    : punch.validationStatus.startsWith('PENDING') || punch.validationStatus === 'ACCEPTED_WITH_WARNING'
      ? 'warning'
      : 'success';
  return { type, text: `${action}: ${copy.label}. Final attendance depends on backend validation.` };
}

export default function AttendanceScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const hasEmployee = user?.employeeId != null;

  const deviceInfo = React.useMemo(() => getDeviceInfo(), []);

  const [deviceIdentifier, setDeviceIdentifier] = React.useState<string | null>(null);
  const [devices, setDevices] = React.useState<MobileDevice[] | null>(null);
  const [isLoadingDeviceStatus, setIsLoadingDeviceStatus] = React.useState(true);
  const [deviceStatusError, setDeviceStatusError] = React.useState<string | null>(null);

  const [locationPermissionStatus, setLocationPermissionStatus] = React.useState<LocationPermissionStatus | null>(
    null,
  );
  const [lastLocationReading, setLastLocationReading] = React.useState<LocationReading | null>(null);

  const [punches, setPunches] = React.useState<AttendanceRawPunch[] | null>(null);
  const [isLoadingPunches, setIsLoadingPunches] = React.useState(true);
  const [punchesError, setPunchesError] = React.useState<string | null>(null);

  const [summaries, setSummaries] = React.useState<AttendanceDailySummary[] | null>(null);
  const [isLoadingSummaries, setIsLoadingSummaries] = React.useState(true);
  const [summariesError, setSummariesError] = React.useState<string | null>(null);

  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [submittingPunchType, setSubmittingPunchType] = React.useState<'IN' | 'OUT' | null>(null);
  /** TIME-01: the last attempt whose server outcome is unknown, retried verbatim by the next tap of the same button. */
  const pendingAttemptRef = React.useRef<PunchAttempt | null>(null);
  const [punchResultMessage, setPunchResultMessage] = React.useState<PunchResultMessage | null>(null);

  const loadDeviceStatus = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!hasEmployee) {
        setIsLoadingDeviceStatus(false);
        return;
      }
      setDeviceStatusError(null);
      try {
        const [identifier, myDevices] = await Promise.all([getDeviceIdentifier(), getMyMobileDevices()]);
        setDeviceIdentifier(identifier);
        setDevices(myDevices);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await logout();
          return;
        }
        if (!options.silent) {
          setDeviceStatusError(error instanceof ApiError ? error.message : 'Could not load device status.');
        }
      } finally {
        setIsLoadingDeviceStatus(false);
      }
    },
    [hasEmployee, logout],
  );

  const loadPunches = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!hasEmployee) {
        setIsLoadingPunches(false);
        return;
      }
      setPunchesError(null);
      try {
        const result = await listMyAttendancePunches({ limit: 10 });
        setPunches(result.data);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await logout();
          return;
        }
        if (!options.silent) {
          setPunchesError(error instanceof ApiError ? error.message : 'Could not load recent punches.');
        }
      } finally {
        setIsLoadingPunches(false);
      }
    },
    [hasEmployee, logout],
  );

  const loadSummaries = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!hasEmployee) {
        setIsLoadingSummaries(false);
        return;
      }
      setSummariesError(null);
      try {
        const result = await listMyAttendanceSummaries({ limit: 15 });
        setSummaries(result.data);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await logout();
          return;
        }
        if (!options.silent) {
          setSummariesError(error instanceof ApiError ? error.message : 'Could not load attendance summaries.');
        }
      } finally {
        setIsLoadingSummaries(false);
      }
    },
    [hasEmployee, logout],
  );

  // Nested functions declared inside the effect (not calls to the outer useCallbacks above) —
  // same pattern as device.tsx, required to avoid the React Compiler's set-state-in-effect rule.
  React.useEffect(() => {
    let cancelled = false;

    async function loadInitialLocationPermission() {
      try {
        const status = await getForegroundPermissionStatus();
        if (!cancelled) {
          setLocationPermissionStatus(status);
        }
      } catch {
        // Leave as null (unknown) — the punch flow will request permission when attempted.
      }
    }

    async function loadInitialDeviceStatus() {
      if (!hasEmployee) {
        if (!cancelled) {
          setIsLoadingDeviceStatus(false);
        }
        return;
      }
      try {
        const [identifier, myDevices] = await Promise.all([getDeviceIdentifier(), getMyMobileDevices()]);
        if (!cancelled) {
          setDeviceIdentifier(identifier);
          setDevices(myDevices);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await logout();
          return;
        }
        if (!cancelled) {
          setDeviceStatusError(error instanceof ApiError ? error.message : 'Could not load device status.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDeviceStatus(false);
        }
      }
    }

    async function loadInitialPunches() {
      if (!hasEmployee) {
        if (!cancelled) {
          setIsLoadingPunches(false);
        }
        return;
      }
      try {
        const result = await listMyAttendancePunches({ limit: 10 });
        if (!cancelled) {
          setPunches(result.data);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await logout();
          return;
        }
        if (!cancelled) {
          setPunchesError(error instanceof ApiError ? error.message : 'Could not load recent punches.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingPunches(false);
        }
      }
    }

    async function loadInitialSummaries() {
      if (!hasEmployee) {
        if (!cancelled) {
          setIsLoadingSummaries(false);
        }
        return;
      }
      try {
        const result = await listMyAttendanceSummaries({ limit: 15 });
        if (!cancelled) {
          setSummaries(result.data);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await logout();
          return;
        }
        if (!cancelled) {
          setSummariesError(error instanceof ApiError ? error.message : 'Could not load attendance summaries.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSummaries(false);
        }
      }
    }

    void loadInitialLocationPermission();
    void loadInitialDeviceStatus();
    void loadInitialPunches();
    void loadInitialSummaries();

    return () => {
      cancelled = true;
    };
  }, [hasEmployee, logout]);

  const currentDevice = React.useMemo(
    () => devices?.find((device) => device.deviceIdentifier === deviceIdentifier) ?? null,
    [devices, deviceIdentifier],
  );
  const isDeviceApproved = currentDevice?.status === 'APPROVED';

  const todayDateString = getKuwaitTodayDateString();
  const todaySummary = React.useMemo(
    () => summaries?.find((summary) => kuwaitDateStringFromWorkDate(summary.workDate) === todayDateString) ?? null,
    [summaries, todayDateString],
  );

  const handleRefresh = () => {
    setIsRefreshing(true);
    Promise.all([loadDeviceStatus(), loadPunches(), loadSummaries()]).finally(() => setIsRefreshing(false));
  };

  const handlePunch = async (punchType: 'IN' | 'OUT') => {
    if (!hasEmployee || !isDeviceApproved || !deviceIdentifier) {
      return;
    }
    setSubmittingPunchType(punchType);
    setPunchResultMessage(null);

    // TIME-01: a previous tap of this same button whose outcome is unknown (network failure/5xx)
    // is resent verbatim — same clientRequestId, same GPS reading — so the server returns the
    // original result instead of recording the punch twice.
    const retryAttempt = reusablePunchAttempt(pendingAttemptRef.current, punchType);
    if (retryAttempt) {
      await submitPunchAttempt(retryAttempt);
      setSubmittingPunchType(null);
      return;
    }
    pendingAttemptRef.current = null;

    try {
      let permissionStatus = locationPermissionStatus;
      if (permissionStatus !== 'granted') {
        permissionStatus = await requestForegroundPermission();
        setLocationPermissionStatus(permissionStatus);
      }
      if (permissionStatus !== 'granted') {
        setPunchResultMessage({
          type: 'error',
          text: 'Location permission is required to punch attendance. Enable it in Settings.',
        });
        return;
      }

      const reading = await getCurrentLocation();
      setLastLocationReading(reading);

      if (reading.accuracy == null || reading.accuracy > MAX_ACCEPTABLE_ACCURACY_METERS) {
        setPunchResultMessage({
          type: 'warning',
          text: 'GPS accuracy is low. Move to an open area and try again.',
        });
        return;
      }

      const deviceIdentifierSource = deviceIdentifier.split(':')[0] ?? 'unknown';

      const attempt = createPunchAttempt({
        punchType,
        // Diagnostic only — the server ignores this for official time (TIME-01).
        clientReportedTime: new Date().toISOString(),
        latitude: reading.latitude,
        longitude: reading.longitude,
        gpsAccuracy: reading.accuracy,
        deviceIdentifier,
        appVersion: deviceInfo.appVersion ?? undefined,
        fraudSignals: {
          mockLocationDetected: reading.mockLocationDetected,
          locationPermissionStatus: permissionStatus,
          deviceIdentifierSource,
        },
      });
      await submitPunchAttempt(attempt);
    } catch (error) {
      // Failures before submission (permission/location) — nothing was sent, nothing to retry.
      setPunchResultMessage({
        type: 'error',
        text: error instanceof ApiError ? error.message : 'Could not submit punch. Please try again.',
      });
    } finally {
      setSubmittingPunchType(null);
    }
  };

  const submitPunchAttempt = async (attempt: PunchAttempt) => {
    pendingAttemptRef.current = attempt;
    try {
      const punch = await createMobilePunch(attempt.input);
      pendingAttemptRef.current = null;
      setPunchResultMessage(describePunchResult(punch));
      await loadPunches({ silent: true });
    } catch (error) {
      if (!isOutcomeUnknown(error)) {
        // The server gave a definitive answer (4xx): this attempt is finished.
        pendingAttemptRef.current = null;
      }
      if (error instanceof ApiError && error.status === 401) {
        await logout();
        return;
      }
      setPunchResultMessage({
        type: 'error',
        text: isOutcomeUnknown(error)
          ? 'Could not confirm your punch (network problem). Tap the same button again to retry — it will not be recorded twice.'
          : error instanceof ApiError
            ? error.message
            : 'Could not submit punch. Please try again.',
      });
    }
  };

  const canPunch = hasEmployee && isDeviceApproved && locationPermissionStatus !== 'denied' && !submittingPunchType;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      refreshControl={hasEmployee ? <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} /> : undefined}
    >
      <Text style={styles.pageTitle}>Attendance</Text>

      {!hasEmployee ? (
        <View style={[styles.section, styles.noticeCard]}>
          <Text style={styles.noticeText}>{NO_EMPLOYEE_MESSAGE}</Text>
        </View>
      ) : (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Today</Text>
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
                  {todaySummary.lockedAt ? <Text style={styles.lockedTag}>🔒 Locked</Text> : null}
                </View>
                <InfoRow label="Official In" value={formatDateTimeForDisplay(todaySummary.officialInTime)} />
                <InfoRow label="Official Out" value={formatDateTimeForDisplay(todaySummary.officialOutTime)} />
                <InfoRow label="Total Worked" value={formatMinutesAsHours(todaySummary.totalWorkedMinutes)} />
                <InfoRow label="Late" value={formatMinutesAsHours(todaySummary.lateMinutes)} />
                <InfoRow label="Early Leave" value={formatMinutesAsHours(todaySummary.earlyLeaveMinutes)} />
                <InfoRow label="Overtime" value={formatMinutesAsHours(todaySummary.overtimeMinutes)} />
              </>
            ) : (
              <>
                <Text style={styles.statusMessage}>No daily summary calculated yet.</Text>
                <Text style={styles.statusMessage}>
                  Your punch has been submitted. HR/system validation will calculate the final daily status.
                </Text>
              </>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Device Status</Text>
            {isLoadingDeviceStatus ? (
              <ActivityIndicator color={colors.accentPrimary} style={styles.spinner} />
            ) : deviceStatusError ? (
              <Text style={styles.errorText}>{deviceStatusError}</Text>
            ) : currentDevice ? (
              <>
                <View style={styles.statusRow}>
                  <View
                    style={[styles.statusDot, { backgroundColor: MOBILE_DEVICE_STATUS_COPY[currentDevice.status].tone }]}
                  />
                  <Text style={styles.statusLabel}>{MOBILE_DEVICE_STATUS_COPY[currentDevice.status].label}</Text>
                </View>
                <Text style={styles.statusMessage}>{MOBILE_DEVICE_STATUS_COPY[currentDevice.status].message}</Text>
              </>
            ) : (
              <>
                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, { backgroundColor: colors.textMuted }]} />
                  <Text style={styles.statusLabel}>Not Registered</Text>
                </View>
                <Text style={styles.statusMessage}>
                  This device isn&apos;t registered yet. Register it before punching attendance.
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.linkButton, pressed && styles.linkButtonPressed]}
                  onPress={() => router.push('/device')}
                >
                  <Text style={styles.linkButtonText}>Go to Device Screen</Text>
                </Pressable>
              </>
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Location Status</Text>
              {/* A labeled status badge, not a toggle: GPS-based punching is already mandatory
                  (architecture.md invariant #6 — mobile signals are hints, backend is
                  authoritative), so a real on/off control would be misleading. This just makes
                  that existing behavior explicit, closer to the benchmark app's framing. */}
              <View style={styles.geoPunchBadge}>
                <Text style={styles.geoPunchBadgeText}>Geo Punch Enabled</Text>
              </View>
            </View>
            {locationPermissionStatus === null ? (
              <ActivityIndicator color={colors.accentPrimary} style={styles.spinner} />
            ) : locationPermissionStatus === 'denied' ? (
              <>
                <Text style={styles.statusMessage}>
                  Location permission denied. Enable it in Settings to punch attendance.
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.linkButton, pressed && styles.linkButtonPressed]}
                  onPress={() => void Linking.openSettings()}
                >
                  <Text style={styles.linkButtonText}>Open Settings</Text>
                </Pressable>
              </>
            ) : locationPermissionStatus === 'undetermined' ? (
              <Text style={styles.statusMessage}>
                Location permission not requested yet. You&apos;ll be asked when you punch.
              </Text>
            ) : lastLocationReading ? (
              <Text style={styles.statusMessage}>
                Location ready — GPS accuracy{' '}
                {lastLocationReading.accuracy != null ? `${Math.round(lastLocationReading.accuracy)}m` : 'unknown'}{' '}
                (
                {lastLocationReading.accuracy != null && lastLocationReading.accuracy <= MAX_ACCEPTABLE_ACCURACY_METERS
                  ? 'acceptable'
                  : 'poor'}
                )
              </Text>
            ) : (
              <Text style={styles.statusMessage}>Location permission granted.</Text>
            )}
          </View>

          <View style={styles.punchButtonRow}>
            <Pressable
              style={({ pressed }) => [
                styles.punchButton,
                styles.punchInButton,
                pressed && canPunch && styles.punchButtonPressed,
                !canPunch && styles.punchButtonDisabled,
              ]}
              onPress={() => handlePunch('IN')}
              disabled={!canPunch}
            >
              {submittingPunchType === 'IN' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.punchButtonText}>Check In</Text>
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.punchButton,
                styles.punchOutButton,
                pressed && canPunch && styles.punchButtonPressed,
                !canPunch && styles.punchButtonDisabled,
              ]}
              onPress={() => handlePunch('OUT')}
              disabled={!canPunch}
            >
              {submittingPunchType === 'OUT' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.punchButtonText}>Check Out</Text>
              )}
            </Pressable>
          </View>

          {punchResultMessage ? (
            <Text
              style={[
                styles.resultText,
                punchResultMessage.type === 'success' && styles.successText,
                punchResultMessage.type === 'warning' && styles.warningText,
                punchResultMessage.type === 'error' && styles.errorText,
              ]}
            >
              {punchResultMessage.text}
            </Text>
          ) : null}

          <Text style={styles.disclaimerText}>
            Final attendance status is determined by HR/backend validation, not by this screen.
          </Text>

          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Latest Punches</Text>
              <Pressable onPress={handleRefresh} disabled={isRefreshing}>
                <Text style={styles.refreshLink}>{isRefreshing ? 'Refreshing…' : 'Refresh'}</Text>
              </Pressable>
            </View>

            {isLoadingPunches ? (
              <ActivityIndicator color={colors.accentPrimary} style={styles.spinner} />
            ) : punchesError ? (
              <Text style={styles.errorText}>{punchesError}</Text>
            ) : punches && punches.length > 0 ? (
              punches.map((punch) => (
                <View key={punch.id} style={styles.punchRow}>
                  <View style={styles.punchRowHeader}>
                    <Text style={styles.punchType}>{punch.punchType}</Text>
                    <View
                      style={[
                        styles.punchStatusDot,
                        { backgroundColor: PUNCH_VALIDATION_STATUS_COPY[punch.validationStatus].tone },
                      ]}
                    />
                    <Text style={styles.punchStatusLabel}>
                      {PUNCH_VALIDATION_STATUS_COPY[punch.validationStatus].label}
                    </Text>
                  </View>
                  <Text style={styles.punchMeta}>{formatDateTimeForDisplay(punch.punchTimeSource)}</Text>
                  <Text style={styles.punchMeta}>
                    {SOURCE_TYPE_LABELS[punch.sourceType]} · {officialFlagLabel(punch.isOfficial)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.statusMessage}>No punches yet.</Text>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Summary History</Text>

            {isLoadingSummaries ? (
              <ActivityIndicator color={colors.accentPrimary} style={styles.spinner} />
            ) : summariesError ? (
              <Text style={styles.errorText}>{summariesError}</Text>
            ) : summaries && summaries.length > 0 ? (
              summaries.map((summary) => (
                <View key={summary.id} style={styles.summaryRow}>
                  <View style={styles.summaryRowHeader}>
                    <Text style={styles.summaryDate}>
                      {formatDateForDisplay(summary.workDate)} · {formatWeekdayForDisplay(summary.workDate)}
                    </Text>
                    <View
                      style={[
                        styles.punchStatusDot,
                        { backgroundColor: DAILY_ATTENDANCE_STATUS_COPY[summary.status].tone },
                      ]}
                    />
                    <Text style={styles.punchStatusLabel}>{DAILY_ATTENDANCE_STATUS_COPY[summary.status].label}</Text>
                    {summary.lockedAt ? <Text style={styles.lockedTag}>🔒</Text> : null}
                  </View>
                  <Text style={styles.punchMeta}>
                    In {formatDateTimeForDisplay(summary.officialInTime)} · Out{' '}
                    {formatDateTimeForDisplay(summary.officialOutTime)}
                  </Text>
                  <Text style={styles.punchMeta}>Worked {formatMinutesAsHours(summary.totalWorkedMinutes)}</Text>
                  {summary.lateMinutes > 0 ||
                  summary.earlyLeaveMinutes > 0 ||
                  summary.overtimeMinutes > 0 ? (
                    <Text style={styles.punchMeta}>
                      {[
                        summary.lateMinutes > 0 ? `Late ${formatMinutesAsHours(summary.lateMinutes)}` : null,
                        summary.earlyLeaveMinutes > 0
                          ? `Early Leave ${formatMinutesAsHours(summary.earlyLeaveMinutes)}`
                          : null,
                        summary.overtimeMinutes > 0
                          ? `Overtime ${formatMinutesAsHours(summary.overtimeMinutes)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  ) : null}
                </View>
              ))
            ) : (
              <Text style={styles.statusMessage}>No daily summaries calculated yet.</Text>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgBase },
  container: { padding: 20 },
  pageTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 16 },
  geoPunchBadge: {
    backgroundColor: colors.success + '1a',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  geoPunchBadgeText: { fontSize: 11, fontWeight: '700', color: colors.success },
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
  spinner: { marginVertical: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  statusMessage: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 18 },
  successText: { color: colors.success },
  warningText: { color: colors.warning },
  linkButton: { marginTop: 10, alignSelf: 'flex-start' },
  linkButtonPressed: { opacity: 0.6 },
  linkButtonText: { color: colors.accentPrimary, fontSize: 13, fontWeight: '600' },
  punchButtonRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  punchButton: {
    flex: 1,
    borderRadius: 20,
    paddingVertical: 20,
    alignItems: 'center',
  },
  punchInButton: { backgroundColor: colors.success },
  punchOutButton: { backgroundColor: colors.textPrimary },
  punchButtonPressed: { opacity: 0.85 },
  punchButtonDisabled: { opacity: 0.4 },
  punchButtonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  resultText: { fontSize: 13, lineHeight: 18, marginBottom: 8, textAlign: 'center' },
  disclaimerText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 16,
  },
  refreshLink: { color: colors.accentPrimary, fontSize: 13, fontWeight: '600' },
  punchRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.bgMuted },
  punchRowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  punchType: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, width: 36 },
  punchStatusDot: { width: 8, height: 8, borderRadius: 4 },
  punchStatusLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, flexShrink: 1 },
  punchMeta: { fontSize: 12, color: colors.textMuted },
  lockedTag: { fontSize: 12, fontWeight: '600', color: colors.locked, marginLeft: 'auto' },
  summaryRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.bgMuted },
  summaryRowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  summaryDate: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
});
