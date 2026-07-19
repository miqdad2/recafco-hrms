/**
 * Asia/Kuwait is a fixed UTC+3 offset year-round (no DST), matching the backend's own
 * apps/api/src/attendance-summaries/kuwait-date.util.ts reasoning — a plain offset is
 * exact for this timezone, not an approximation. If a future site needs a DST-observing
 * timezone, replace this with a real tz library rather than extending the offset.
 */
const KUWAIT_UTC_OFFSET_MS = 3 * 60 * 60_000;

function formatUtcDateParts(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** "Now" is a real UTC instant — shift by the fixed Kuwait offset to get today's Kuwait calendar date. */
export function getKuwaitTodayDateString(): string {
  return formatUtcDateParts(new Date(Date.now() + KUWAIT_UTC_OFFSET_MS));
}

/**
 * A daily summary's `workDate` is already stored as UTC-midnight-of-the-Kuwait-day
 * (see the backend's `toKuwaitWorkDate`) — read its UTC date parts directly. Do not
 * re-apply the Kuwait offset here, that would shift it a second time.
 */
export function kuwaitDateStringFromWorkDate(workDateIso: string): string {
  return formatUtcDateParts(new Date(workDateIso));
}

/** For a real moment-in-time (a punch or official in/out timestamp) — shown in the device's own local time, which is what an employee physically at work expects to see. */
export function formatDateTimeForDisplay(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  return new Date(iso).toLocaleString();
}

/**
 * For a `workDate` value specifically — this is a labeled calendar day, not a real
 * moment-in-time, so it must always be read back in UTC. Formatting it in the device's
 * local timezone could shift the displayed date by a day depending on where the
 * device's clock is set, even though the value itself never moves.
 */
export function formatDateForDisplay(workDateIso: string): string {
  return new Date(workDateIso).toLocaleDateString(undefined, { timeZone: 'UTC' });
}

export function formatMinutesAsHours(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}
