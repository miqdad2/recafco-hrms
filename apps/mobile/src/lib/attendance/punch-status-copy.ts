import type { AttendanceSourceType, PunchValidationStatus } from '../api/attendance-punches';
import { colors } from '../theme';

export const PUNCH_VALIDATION_STATUS_COPY: Record<PunchValidationStatus, { label: string; tone: string }> = {
  ACCEPTED: { label: 'Accepted', tone: colors.success },
  ACCEPTED_WITH_WARNING: { label: 'Accepted by system', tone: colors.warning },
  PENDING_HR_REVIEW: { label: 'Submitted, waiting for review', tone: colors.warning },
  PENDING_MANAGER_APPROVAL: { label: 'Submitted, waiting for manager approval', tone: colors.warning },
  REJECTED_DUPLICATE: { label: 'Duplicate punch', tone: colors.textMuted },
  REJECTED_OUTSIDE_LOCATION: { label: 'Rejected: outside allowed location', tone: colors.error },
  REJECTED_FAKE_GPS: { label: 'Rejected: location issue detected', tone: colors.error },
  REJECTED_UNREGISTERED_DEVICE: { label: 'Rejected: device not approved', tone: colors.error },
  REJECTED_EMPLOYEE_INACTIVE: { label: 'Rejected: employee inactive', tone: colors.error },
  REJECTED_POLICY_VIOLATION: { label: 'Rejected: policy violation', tone: colors.error },
};

export function officialFlagLabel(isOfficial: boolean): string {
  return isOfficial ? 'Official' : 'Not yet official';
}

export const SOURCE_TYPE_LABELS: Record<AttendanceSourceType, string> = {
  MOBILE: 'Mobile',
  BIOMETRIC_DEVICE: 'Biometric Device',
  FACE_DEVICE: 'Face Device',
  CARD_DEVICE: 'Card Device',
  WEB: 'Web',
  MANUAL_CORRECTION: 'Manual Correction',
  IMPORT: 'Import',
  FUTURE_INTEGRATION: 'Other',
};
