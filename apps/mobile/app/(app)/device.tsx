import * as React from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ApiError } from '../../src/lib/api/client';
import {
  getMyMobileDevices,
  registerMobileDevice,
  type MobileDevice,
  type MobilePlatform,
} from '../../src/lib/api/mobile-devices';
import { InfoRow } from '../../src/components/info-row';
import { useAuth } from '../../src/lib/auth/auth-context';
import { NO_EMPLOYEE_MESSAGE } from '../../src/lib/auth/no-employee-message';
import { getDeviceIdentifier } from '../../src/lib/device/device-identifier';
import { getDeviceInfo, type DeviceInfo } from '../../src/lib/device/device-info';
import { MOBILE_DEVICE_STATUS_COPY, maskDeviceIdentifier } from '../../src/lib/device/device-status-copy';
import { colors } from '../../src/lib/theme';

function toBackendPlatform(platform: DeviceInfo['platform']): MobilePlatform {
  if (platform === 'android') {
    return 'ANDROID';
  }
  if (platform === 'ios') {
    return 'IOS';
  }
  return 'UNKNOWN';
}

export default function DeviceScreen() {
  const { user, logout } = useAuth();
  const hasEmployee = user?.employeeId != null;

  const deviceInfo = React.useMemo(() => getDeviceInfo(), []);
  const [deviceIdentifier, setDeviceIdentifier] = React.useState<string | null>(null);
  const [devices, setDevices] = React.useState<MobileDevice[] | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [isRegistering, setIsRegistering] = React.useState(false);
  const [registerMessage, setRegisterMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  );

  const loadStatus = React.useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!hasEmployee) {
        setIsLoadingStatus(false);
        return;
      }
      setStatusError(null);
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
          setStatusError(error instanceof ApiError ? error.message : 'Could not load device status.');
        }
      } finally {
        setIsLoadingStatus(false);
        setIsRefreshing(false);
      }
    },
    [hasEmployee, logout],
  );

  // Deliberately not `void loadStatus()` here: calling an outer useCallback directly in an
  // effect body trips the React Compiler's set-state-in-effect lint rule. A function declared
  // inside the effect (same pattern as auth-context.tsx's restoreSession) is exempt, so the
  // mount-time fetch is inlined here; `loadStatus` above remains the reusable path for the
  // refresh button and the post-registration reload, both triggered from event handlers, not effects.
  React.useEffect(() => {
    let cancelled = false;

    async function loadInitialStatus() {
      if (!hasEmployee) {
        if (!cancelled) {
          setIsLoadingStatus(false);
        }
        return;
      }
      setStatusError(null);
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
          setStatusError(error instanceof ApiError ? error.message : 'Could not load device status.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingStatus(false);
        }
      }
    }

    void loadInitialStatus();
    return () => {
      cancelled = true;
    };
  }, [hasEmployee, logout]);

  const currentDevice = React.useMemo(
    () => devices?.find((device) => device.deviceIdentifier === deviceIdentifier) ?? null,
    [devices, deviceIdentifier],
  );

  const handleRefresh = () => {
    setIsRefreshing(true);
    void loadStatus();
  };

  const handleRegister = async () => {
    if (!hasEmployee || !deviceIdentifier) {
      return;
    }
    setIsRegistering(true);
    setRegisterMessage(null);
    try {
      await registerMobileDevice({
        deviceIdentifier,
        platform: toBackendPlatform(deviceInfo.platform),
        deviceName: deviceInfo.deviceName ?? undefined,
        manufacturer: deviceInfo.manufacturer ?? undefined,
        model: deviceInfo.model ?? undefined,
        osVersion: deviceInfo.osVersion ?? undefined,
        appVersion: deviceInfo.appVersion ?? undefined,
      });
      setRegisterMessage({
        type: 'success',
        text: 'Device registration submitted. Waiting for HR approval.',
      });
      await loadStatus({ silent: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await logout();
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        setRegisterMessage({
          type: 'error',
          text: 'This device appears to be registered to another employee. Contact HR.',
        });
      } else if (error instanceof ApiError) {
        setRegisterMessage({ type: 'error', text: error.message });
      } else {
        setRegisterMessage({ type: 'error', text: 'Could not register this device. Please try again.' });
      }
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      refreshControl={
        hasEmployee ? <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} /> : undefined
      }
    >
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>This Device</Text>
        <InfoRow label="Platform" value={deviceInfo.platform} />
        <InfoRow label="Device Name" value={deviceInfo.deviceName ?? '—'} />
        <InfoRow label="Manufacturer" value={deviceInfo.manufacturer ?? '—'} />
        <InfoRow label="Model" value={deviceInfo.model ?? '—'} />
        <InfoRow label="OS Version" value={deviceInfo.osVersion ?? '—'} />
        <InfoRow label="App Version" value={deviceInfo.appVersion ?? '—'} />
        <InfoRow label="Device ID" value={deviceIdentifier ? maskDeviceIdentifier(deviceIdentifier) : '—'} />
      </View>

      {!hasEmployee ? (
        <View style={[styles.section, styles.noticeCard]}>
          <Text style={styles.noticeText}>{NO_EMPLOYEE_MESSAGE}</Text>
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Registration Status</Text>

          {isLoadingStatus ? (
            <ActivityIndicator color={colors.accentPrimary} style={styles.statusSpinner} />
          ) : statusError ? (
            <Text style={styles.errorText}>{statusError}</Text>
          ) : currentDevice ? (
            <>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: MOBILE_DEVICE_STATUS_COPY[currentDevice.status].tone }]} />
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
              <Text style={styles.statusMessage}>You haven&apos;t registered this device yet.</Text>
            </>
          )}

          {registerMessage ? (
            <Text style={registerMessage.type === 'success' ? styles.successText : styles.errorText}>
              {registerMessage.text}
            </Text>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              (isRegistering || !deviceIdentifier) && styles.buttonDisabled,
            ]}
            onPress={handleRegister}
            disabled={isRegistering || !deviceIdentifier || isLoadingStatus}
          >
            {isRegistering ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>{currentDevice ? 'Update Registration' : 'Register Device'}</Text>
            )}
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.refreshButton, pressed && styles.refreshButtonPressed]}
            onPress={handleRefresh}
            disabled={isRefreshing || isLoadingStatus}
          >
            <Text style={styles.refreshButtonText}>{isRefreshing ? 'Refreshing…' : 'Refresh Status'}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgBase },
  container: { padding: 20 },
  section: {
    backgroundColor: colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 10 },
  noticeCard: { backgroundColor: '#fffbeb' },
  noticeText: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  statusSpinner: { marginVertical: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  statusMessage: { fontSize: 13, color: colors.textSecondary, marginBottom: 12, lineHeight: 18 },
  errorText: { color: colors.error, fontSize: 13, marginBottom: 12, lineHeight: 18 },
  successText: { color: colors.success, fontSize: 13, marginBottom: 12, lineHeight: 18 },
  button: {
    backgroundColor: colors.accentPrimary,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonPressed: { backgroundColor: colors.accentPrimaryHover },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  refreshButton: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  refreshButtonPressed: { opacity: 0.6 },
  refreshButtonText: { color: colors.accentPrimary, fontSize: 14, fontWeight: '600' },
});
