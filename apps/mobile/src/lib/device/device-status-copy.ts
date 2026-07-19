import type { MobileDeviceStatus } from '../api/mobile-devices';
import { colors } from '../theme';

export const MOBILE_DEVICE_STATUS_COPY: Record<MobileDeviceStatus, { label: string; tone: string; message: string }> = {
  PENDING_APPROVAL: {
    label: 'Pending Approval',
    tone: colors.warning,
    message: 'Your device registration is waiting for HR approval.',
  },
  APPROVED: {
    label: 'Approved',
    tone: colors.success,
    message: 'This device is approved for mobile attendance.',
  },
  BLOCKED: {
    label: 'Blocked',
    tone: colors.error,
    message: 'This device is blocked. Contact HR.',
  },
  DEACTIVATED: {
    label: 'Deactivated',
    tone: colors.textMuted,
    message: 'This device is deactivated. Register again or contact HR.',
  },
};

export function maskDeviceIdentifier(identifier: string): string {
  if (identifier.length <= 10) {
    return `${identifier.slice(0, 2)}••••`;
  }
  return `${identifier.slice(0, 6)}••••${identifier.slice(-4)}`;
}
