/**
 * Asia/Kuwait is a fixed UTC+3 offset year-round (no DST), so attendance-date
 * calculation can use a plain offset instead of a full IANA timezone database.
 * If a future site ever needs a DST-observing timezone, this must be replaced
 * with a real tz library (e.g. luxon/date-fns-tz) rather than extending the offset.
 */
const KUWAIT_UTC_OFFSET_MS = 3 * 60 * 60_000;

/** Converts a UTC instant (e.g. a punch's punchTimeSource) into the UTC-midnight Date representing its Asia/Kuwait calendar day. */
export function toKuwaitWorkDate(utcInstant: Date): Date {
  const shifted = new Date(utcInstant.getTime() + KUWAIT_UTC_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/** Given a workDate (as produced by toKuwaitWorkDate), returns the [start, end) UTC instant range covering that Kuwait calendar day. */
export function kuwaitWorkDateRange(workDate: Date): { start: Date; end: Date } {
  const start = new Date(workDate.getTime() - KUWAIT_UTC_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  return { start, end };
}

/** Parses a plain "YYYY-MM-DD" (or full ISO) date-string request field into a canonical UTC-midnight workDate value, ignoring any time-of-day component. */
export function parseWorkDateInput(value: string): Date {
  const datePart = value.split('T')[0] ?? '';
  const parts = datePart.split('-').map(Number);
  const [year, month, day] = parts;
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n)) || year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid workDate value: ${value}`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

/** Adds shiftMinutes (from midnight) to the start of the given Kuwait workDate, returning the absolute UTC instant. */
export function addShiftMinutesToWorkDate(workDate: Date, minutesFromMidnight: number): Date {
  const { start } = kuwaitWorkDateRange(workDate);
  return new Date(start.getTime() + minutesFromMidnight * 60_000);
}
