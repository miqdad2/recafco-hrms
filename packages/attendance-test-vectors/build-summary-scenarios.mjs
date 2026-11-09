#!/usr/bin/env node
/**
 * Generates summary-v1.scenarios.json — shared, deterministic NestJS/Rust parity inputs for the
 * daily attendance summary calculator (RUST-03). Synthetic data only.
 *
 * Times are written as Asia/Kuwait local time (UTC+3) for readability and converted to UTC.
 * Work date under test is 2026-11-08 unless a scenario says otherwise. No two eligible punches of
 * the same direction share a timestamp (NestJS tie order is undefined — see the design doc).
 *
 *   node packages/attendance-test-vectors/build-summary-scenarios.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATE = '2026-11-08';
/** Kuwait local "YYYY-MM-DD HH:MM[:SS[.mmm]]" or "HH:MM[...]" (on DATE) → UTC ISO string. */
function k(local) {
  const [d, t] = local.includes(' ') ? local.split(' ') : [DATE, local];
  const [hh, mm, ssRaw = '0'] = t.split(':');
  const [ss, ms = '0'] = ssRaw.split('.');
  const utc = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), +hh - 3, +mm, +ss, +ms.padEnd(3, '0'));
  return new Date(utc).toISOString();
}

const DAY = { id: 'shift-day', startTimeMinutes: 420, endTimeMinutes: 960, isOvernight: false, gracePeriodMinutes: 15, breakMinutes: 60, isActive: true }; // 07:00–16:00
const LATE_SHIFT = { id: 'shift-late', startTimeMinutes: 540, endTimeMinutes: 1080, isOvernight: false, gracePeriodMinutes: 0, breakMinutes: 0, isActive: true }; // 09:00–18:00
const NIGHT = { id: 'shift-night', startTimeMinutes: 1320, endTimeMinutes: 360, isOvernight: true, gracePeriodMinutes: 10, breakMinutes: 30, isActive: true }; // 22:00–06:00
const assign = (shift, from = '2026-01-01T00:00:00.000Z', to = undefined, id = `sa-${shift.id}`) => ({ id, effectiveFrom: from, ...(to ? { effectiveTo: to } : {}), shift });

let seq = 0;
const p = (type, source, at, status = 'ACCEPTED', extra = {}) => {
  seq += 1;
  return { id: `p${String(seq).padStart(2, '0')}-${type.toLowerCase()}-${source === 'MOBILE' ? 'mob' : source === 'BIOMETRIC_DEVICE' ? 'bio' : source.toLowerCase()}`, punchType: type, sourceType: source, validationStatus: status, punchTimeSource: at, ...extra };
};
const M = 'MOBILE';
const B = 'BIOMETRIC_DEVICE';

const scenario = (id, title, punches, over = {}) => ({
  id,
  title,
  input: { employeeId: 'emp-1', workDate: DATE, punches, shiftAssignments: [assign(DAY)], ...over },
});

const scenarios = [
  scenario('S01-normal-day', 'Normal day: IN 06:55, OUT 16:05 (mobile)', [p('IN', M, k('06:55')), p('OUT', M, k('16:05'))]),
  scenario('S02-early-in', 'Early IN 06:30 is not overtime; late = 0', [p('IN', M, k('06:30')), p('OUT', M, k('16:00'))]),
  scenario('S03-late-in', 'Late IN 07:20 → LATE, 20 late minutes', [p('IN', M, k('07:20')), p('OUT', M, k('16:00'))]),
  scenario('S04-early-out', 'Early OUT 15:30 → 30 early-leave minutes; status still PRESENT', [p('IN', M, k('07:00')), p('OUT', M, k('15:30'))]),
  scenario('S05-late-out-overtime', 'OUT 16:45 → 45 overtime minutes (no approval concept)', [p('IN', M, k('07:00')), p('OUT', M, k('16:45'))]),
  scenario('S06-exact-schedule', 'Exactly 07:00:00 / 16:00:00', [p('IN', M, k('07:00')), p('OUT', M, k('16:00'))]),
  scenario('S07-mobile-in-biometric-out', 'Mobile IN + biometric OUT', [p('IN', M, k('06:58')), p('OUT', B, k('16:02'))]),
  scenario('S08-biometric-in-mobile-out', 'Biometric IN + mobile OUT', [p('IN', B, k('06:57')), p('OUT', M, k('16:03'))]),
  scenario('S09-mobile-in-mobile-out', 'Mobile IN + mobile OUT', [p('IN', M, k('07:01')), p('OUT', M, k('16:01'))]),
  scenario('S10-biometric-in-biometric-out', 'Biometric IN + biometric OUT', [p('IN', B, k('06:59')), p('OUT', B, k('16:04'))]),
  scenario('S11-missing-in', 'Only an OUT → MISSING_PUNCH, all minutes 0', [p('OUT', B, k('16:00'))]),
  scenario('S12-missing-out', 'Only a late IN → MISSING_PUNCH; late minutes are NOT computed without an OUT', [p('IN', M, k('07:40'))]),
  scenario('S13-no-punches', 'No punches at all → ABSENT row (when the calculator is invoked)', []),
  scenario('S14-rejected-ignored', 'Rejected earlier IN ignored; accepted IN used', [p('IN', M, k('06:30'), 'REJECTED_OUTSIDE_LOCATION'), p('IN', M, k('07:05')), p('OUT', M, k('16:00'))]),
  scenario('S15-pending-ignored', 'PENDING_HR_REVIEW later OUT ignored', [p('IN', B, k('07:00')), p('OUT', B, k('16:00')), p('OUT', M, k('17:30'), 'PENDING_HR_REVIEW')]),
  scenario('S16-accepted-with-warning', 'ACCEPTED_WITH_WARNING (approved correction) counts as eligible', [p('IN', 'MANUAL_CORRECTION', k('07:00'), 'ACCEPTED_WITH_WARNING'), p('OUT', B, k('16:00'))]),
  scenario('S17-multiple-ins-earliest-wins', 'Three accepted INs → earliest is official', [p('IN', M, k('07:10')), p('IN', B, k('06:58')), p('IN', M, k('07:30')), p('OUT', B, k('16:00'))]),
  scenario('S18-multiple-outs-latest-wins', 'Three accepted OUTs → latest is official', [p('IN', B, k('07:00')), p('OUT', M, k('15:00')), p('OUT', B, k('16:20')), p('OUT', M, k('16:05'))]),
  scenario('S19-duplicate-excluded', 'REJECTED_DUPLICATE IN ignored even though earlier', [p('IN', M, k('06:50'), 'REJECTED_DUPLICATE'), p('IN', M, k('06:52')), p('OUT', M, k('16:00'))]),
  scenario('S20-no-shift', 'No shift assignment → only total worked minutes; no late even at 09:00', [p('IN', M, k('09:00')), p('OUT', M, k('17:00'))], { shiftAssignments: [] }),
  scenario('S21-kuwait-midnight-boundaries', 'Day window is [00:00, 24:00) Kuwait: both edges included/excluded correctly', [
    p('IN', M, k('2026-11-07 23:59:59.999')),
    p('IN', B, k('00:00:00.000')),
    p('OUT', M, k('23:59:59.999')),
    p('OUT', B, k('2026-11-09 00:00:00.000')),
  ]),
  scenario('S22-overnight-shift-in-day', 'Night shift 22:00–06:00: IN 22:05 on 8 Nov, OUT 06:00 on 9 Nov → 8 Nov has no OUT (calendar-day grouping)', [p('IN', B, k('22:05')), p('OUT', B, k('2026-11-09 06:00'))], { shiftAssignments: [assign(NIGHT)] }),
  scenario('S23-overnight-shift-next-day', 'Same night shift, calculating 9 Nov: OUT 06:00 and next IN 22:01 → official IN 22:01, OUT 06:00 (OUT before IN)', [p('IN', B, k('22:05')), p('OUT', B, k('2026-11-09 06:00')), p('IN', B, k('2026-11-09 22:01'))], { workDate: '2026-11-09', shiftAssignments: [assign(NIGHT)] }),
  scenario('S24-overnight-both-after-midnight', 'Night shift, IN 00:10 and OUT 06:00 same Kuwait day → shift end is next day, 1440 early-leave minutes', [p('IN', B, k('00:10')), p('OUT', B, k('06:00'))], { shiftAssignments: [assign(NIGHT)] }),
  scenario('S25-grace-not-applied', 'Grace 15 min stored; IN 07:10 still LATE 10', [p('IN', M, k('07:10')), p('OUT', M, k('16:00'))]),
  scenario('S26-break-not-deducted', 'Break 60 min stored; 07:00–16:00 still 540 worked minutes', [p('IN', B, k('07:00')), p('OUT', B, k('16:00'))]),
  scenario('S27-overtime-exact-end', 'OUT exactly 16:00:00 → overtime 0, early 0', [p('IN', B, k('07:00')), p('OUT', B, k('16:00:00'))]),
  scenario('S28-overtime-29s', 'OUT 16:00:29 → rounds to 0 overtime', [p('IN', B, k('07:00')), p('OUT', B, k('16:00:29'))]),
  scenario('S29-overtime-30s', 'OUT 16:00:30 → rounds to 1 overtime minute', [p('IN', B, k('07:00')), p('OUT', B, k('16:00:30'))]),
  scenario('S30-late-30s-is-late', 'IN 07:00:30 → 1 late minute → status LATE', [p('IN', M, k('07:00:30')), p('OUT', M, k('16:00'))]),
  scenario('S31-late-29s-is-present', 'IN 07:00:29 → 0 late minutes → PRESENT', [p('IN', M, k('07:00:29')), p('OUT', M, k('16:00'))]),
  scenario('S32-worked-minutes-rounding', 'IN 07:00:20, OUT 15:59:50 → 539.5 min rounds to 540', [p('IN', M, k('07:00:20')), p('OUT', B, k('15:59:50'))]),
  scenario('S33-mixed-sources-selection', 'Mixed: bio IN 06:59 beats mobile IN 07:02; mobile OUT 16:10 beats bio OUT 16:03', [p('IN', M, k('07:02')), p('IN', B, k('06:59')), p('OUT', M, k('16:10')), p('OUT', B, k('16:03'))]),
  scenario('S34-payroll-period-locked', 'Locked payroll period → refused; official flags untouched', [p('IN', M, k('07:00'), 'ACCEPTED', { isOfficial: true }), p('OUT', M, k('16:30'))], { periodLocked: true, existingSummary: { calculationVersion: 2, locked: true } }),
  scenario('S35-summary-locked-without-period', 'Summary row lockedAt set (period not locked) → refused', [p('IN', M, k('07:00'), 'ACCEPTED', { isOfficial: true }), p('OUT', M, k('16:00'))], { existingSummary: { calculationVersion: 1, locked: true } }),
  scenario('S36-recalculation-increments-version', 'Existing summary version 3 → 4', [p('IN', M, k('07:00')), p('OUT', M, k('16:00'))], { existingSummary: { calculationVersion: 3, locked: false } }),
  scenario('S37-official-flags-reassigned', 'Stale official flag on a now-rejected punch is cleared; yesterday official punch untouched', [
    p('IN', M, k('2026-11-07 07:00'), 'ACCEPTED', { isOfficial: true }),
    p('IN', M, k('06:40'), 'REJECTED_FAKE_GPS', { isOfficial: true }),
    p('IN', B, k('07:03')),
    p('OUT', B, k('16:00'), 'ACCEPTED', { isOfficial: true }),
    p('OUT', B, k('16:30')),
  ]),
  scenario('S38-out-before-in', 'Existing behaviour: OUT 06:00 before IN 07:00 → 0 worked minutes yet PRESENT', [p('OUT', B, k('06:00')), p('IN', M, k('07:00'))]),
  scenario('S39-break-punches-ignored', 'BREAK_START/BREAK_END do not affect anything', [p('IN', B, k('07:00')), p('BREAK_START', B, k('12:00')), p('BREAK_END', B, k('13:00')), p('OUT', B, k('16:00'))]),
  scenario('S40-latest-assignment-wins', 'Two applicable assignments → latest effectiveFrom (09:00–18:00 shift) applies', [p('IN', M, k('08:55')), p('OUT', M, k('18:10'))], {
    shiftAssignments: [assign(DAY), assign(LATE_SHIFT, k('2026-11-01 00:00'))],
  }),
  scenario('S41-ended-assignment-ignored', 'Newer assignment ended before the day starts → older applies', [p('IN', M, k('07:05')), p('OUT', M, k('16:00'))], {
    shiftAssignments: [assign(DAY), assign(LATE_SHIFT, k('2026-11-01 00:00'), k('2026-11-07 23:59'))],
  }),
  scenario('S42-assignment-ending-at-day-start-applies', 'effectiveTo exactly at Kuwait day start still applies (>=)', [p('IN', M, k('09:30')), p('OUT', M, k('18:00'))], {
    shiftAssignments: [assign(DAY), assign(LATE_SHIFT, k('2026-11-01 00:00'), k('00:00'))],
  }),
  scenario('S43-assignment-starting-next-day-ignored', 'effectiveFrom exactly at Kuwait day end does not apply (<)', [p('IN', M, k('07:10')), p('OUT', M, k('16:00'))], {
    shiftAssignments: [assign(DAY), assign(LATE_SHIFT, k('2026-11-09 00:00'))],
  }),
  scenario('S44-inactive-shift-still-applies', 'Existing behaviour: Shift.isActive=false is not consulted', [p('IN', M, k('07:15')), p('OUT', M, k('16:00'))], {
    shiftAssignments: [assign({ ...DAY, id: 'shift-retired', isActive: false })],
  }),
  scenario('S45-implicit-overnight', 'End <= start without isOvernight (20:00–04:00) is treated as overnight', [p('IN', B, k('20:00')), p('OUT', B, k('23:00'))], {
    shiftAssignments: [assign({ id: 'shift-evening', startTimeMinutes: 1200, endTimeMinutes: 240, isOvernight: false, gracePeriodMinutes: 0, breakMinutes: 0, isActive: true })],
  }),
  scenario('S46-other-day-punches-ignored', 'Punches on 7 and 9 Nov (Kuwait) never affect 8 Nov', [p('IN', M, k('2026-11-07 07:00')), p('OUT', M, k('2026-11-09 16:00')), p('IN', B, k('07:02')), p('OUT', B, k('15:58'))]),
  scenario('S47-only-rejected-punches', 'Every punch rejected → ABSENT', [p('IN', M, k('07:00'), 'REJECTED_OUTSIDE_LOCATION'), p('OUT', M, k('16:00'), 'REJECTED_UNREGISTERED_DEVICE')]),
  scenario('S48-pending-manager-approval-manual', 'Manual punch PENDING_MANAGER_APPROVAL ignored → MISSING_PUNCH', [p('IN', 'MANUAL_CORRECTION', k('07:00'), 'PENDING_MANAGER_APPROVAL'), p('OUT', B, k('16:00'))]),
];

const document = {
  schemaVersion: 'recafco-attendance-summary-scenarios/1',
  rulesetVersion: 'nest-post-time01-2026-11-08',
  resultContractVersion: 'attendance-daily-summary-result/1',
  notes:
    'Synthetic data only. Inputs only — expected outcomes live in summary-v1.expected.json (recorded from NestJS AttendanceSummaryCalculatorService.calculateForEmployeeDate, reviewed, frozen). Times are UTC; titles use Asia/Kuwait local time.',
  scenarios: JSON.parse(JSON.stringify(scenarios)),
};
const out = join(dirname(fileURLToPath(import.meta.url)), 'summary-v1.scenarios.json');
writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
console.log(`wrote ${scenarios.length} scenarios to ${out}`);
