import type { DailyAttendanceStatus } from '../api/attendance-summaries';
import { colors } from '../theme';

export const DAILY_ATTENDANCE_STATUS_COPY: Record<DailyAttendanceStatus, { label: string; tone: string }> = {
  PRESENT: { label: 'Present', tone: colors.success },
  ABSENT: { label: 'Absent', tone: colors.error },
  LATE: { label: 'Late', tone: colors.warning },
  HALF_DAY: { label: 'Half Day', tone: colors.warning },
  LEAVE: { label: 'Leave', tone: colors.info },
  WEEK_OFF: { label: 'Week Off', tone: colors.textMuted },
  HOLIDAY: { label: 'Holiday', tone: colors.textMuted },
  MISSING_PUNCH: { label: 'Missing Punch', tone: colors.warning },
};
