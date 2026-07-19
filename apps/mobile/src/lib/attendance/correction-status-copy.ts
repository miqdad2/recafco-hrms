import type { CorrectionStatus, CorrectionType } from '../api/attendance-corrections';
import { colors } from '../theme';

export const CORRECTION_STATUS_COPY: Record<CorrectionStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Waiting for approval', tone: colors.warning },
  APPROVED: { label: 'Approved', tone: colors.success },
  REJECTED: { label: 'Rejected', tone: colors.error },
  CANCELLED: { label: 'Cancelled', tone: colors.textMuted },
};

export const CORRECTION_TYPE_LABELS: Record<CorrectionType, string> = {
  MISSED_IN: 'Missed Check-In',
  MISSED_OUT: 'Missed Check-Out',
  WRONG_IN: 'Wrong Check-In Time',
  WRONG_OUT: 'Wrong Check-Out Time',
  MANUAL_ADJUSTMENT: 'Manual Adjustment',
  OTHER: 'Other',
};

/** Mirrors the backend's own RequestCorrectionDto @ValidateIf rules — the form only shows/requires
 * the fields the backend will actually validate for the selected correction type. */
export const CORRECTION_TYPES_REQUIRING_PUNCH_TIME: CorrectionType[] = [
  'MISSED_IN',
  'MISSED_OUT',
  'WRONG_IN',
  'WRONG_OUT',
  'MANUAL_ADJUSTMENT',
];

export const CORRECTION_TYPES_REQUIRING_PUNCH_TYPE: CorrectionType[] = ['MANUAL_ADJUSTMENT'];

export const CORRECTION_TYPES_REQUIRING_TARGET_PUNCH: CorrectionType[] = ['WRONG_IN', 'WRONG_OUT'];
