# Shift and Payroll-Grade Attendance Rules — Current Behaviour and Future Design

| | |
| --- | --- |
| Unit | RUST-03 (design only; **no rule in the "Proposed" or "Awaiting HR" columns is active**) |
| Date | 2026-11-08 |
| Authoritative current implementation | NestJS `AttendanceSummaryCalculatorService.calculateForEmployeeDate` (post-TIME-01) |
| Rust port | `apps/attendance-engine/src/domain/{summary,shift,punch_pairing,working_time,summary_status}.rs` — 48/48 parity |

This document is for engineers, AI agents and RECAFCO HR/payroll reviewers.

Classification used throughout:
- **EXISTING**: verified current behaviour, pinned by `packages/attendance-test-vectors/summary-v1.*`.
- **PROPOSED**: an engineering proposal, not active.
- **HR**: awaiting a RECAFCO HR decision; nothing is implemented until HR confirms.

No payroll rule may be activated without HR sign-off, a new `rulesetVersion`, re-recorded parity fixtures, and an implementation in both NestJS and Rust. **No KD salary amount is calculated anywhere in the system.**

---

## 1. Current calculation (EXISTING, exact)

| Step | Current rule | Fixture |
| --- | --- | --- |
| Work date | Asia/Kuwait calendar day `[00:00, 24:00)` (fixed UTC+3) of the punch's official instant (`punchTimeSource`: server receipt for mobile, device event time for biometric) | S21 |
| Eligible punches | `ACCEPTED` or `ACCEPTED_WITH_WARNING` only. Rejected, duplicate, `PENDING_HR_REVIEW` and `PENDING_MANAGER_APPROVAL` are ignored. | S14–S16, S19, S47, S48 |
| Official IN | Earliest eligible `IN` of the day | S17, S33 |
| Official OUT | Latest eligible `OUT` of the day | S18, S33 |
| Mixed sources | Source-agnostic: any mobile/biometric/manual combination; each official punch keeps its own source | S07–S10, S33 |
| Breaks | `BREAK_START`/`BREAK_END` punches ignored | S39 |
| Shift | The assignment overlapping the day with the **latest `effectiveFrom`**; `effectiveTo` inclusive (`>= dayStart`), `effectiveFrom` exclusive of day end | S40–S43 |
| Overnight | `isOvernight` or `end <= start` → shift end placed on the next day; **punches still grouped by calendar day** | S22–S24, S45 |
| Worked minutes | `max(0, round((OUT − IN)/60 s))`, rounded half-up (JavaScript `Math.round`) | S32 |
| Late | `max(0, round((IN − shiftStart)/60 s))` | S03, S30, S31 |
| Early leave | `max(0, round((shiftEnd − OUT)/60 s))` | S04 |
| Overtime | `max(0, round((OUT − shiftEnd)/60 s))`; no approval concept; early arrival is not overtime | S02, S05, S27–S29 |
| No shift | Only worked minutes; late/early/overtime are 0 | S20 |
| Missing IN or OUT | All minutes 0 | S11, S12 |
| Status | IN and OUT → `LATE` if late > 0, else `PRESENT` (early leave ignored). One of them → `MISSING_PUNCH`. Neither → `ABSENT`. | S13, S38 |
| Never produced | `HALF_DAY`, `LEAVE`, `WEEK_OFF`, `HOLIDAY` | — |
| Official flags | Within the day, exactly the chosen IN/OUT are `isOfficial`; stale flags are cleared; other days untouched | S37 |
| Version | `calculationVersion = previous + 1` | S36 |
| Locks | A locked payroll period refuses, and is checked first; a summary with `lockedAt` refuses. Nothing is changed. | S34, S35 |
| When it runs | After each accepted punch, after correction approval, or on an HR recalculation request. Days with no punch at all get **no** row. | — |

### Current defects and limitations (EXISTING; not corrected — each needs an HR decision)

| # | Behaviour | Impact | Fixture |
| --- | --- | --- | --- |
| D1 | **Grace period stored but not applied.** 10 min late with a 15 min grace is still `LATE 10`. | Over-reports lateness | S25 |
| D2 | **Break minutes stored but not deducted.** 07:00–16:00 counts as 540, not 480. | Over-reports worked time | S26 |
| D3 | **30 seconds late = 1 late minute = `LATE` status** (half-up rounding of seconds) | Harsh status for trivial lateness | S30 vs S31 |
| D4 | **Overnight shifts are split across two days.** A night shift (22:00–06:00) shows `MISSING_PUNCH` on both days, or nonsensical values (1440 early-leave minutes). | Night-shift staff mis-reported | S22–S24 |
| D5 | **OUT before IN is accepted as PRESENT** with 0 worked minutes, e.g. an IN that is the next shift's punch | Hides a missing punch | S38, S23 |
| D6 | `Shift.isActive` is not consulted | A retired shift still applies | S44 |
| D7 | Equal timestamps: the IN/OUT choice is database-order dependent | Non-deterministic in a rare edge case | (excluded from fixtures) |
| D8 | Equal `effectiveFrom` on two assignments: the choice is database-order dependent | Ambiguous shift | (excluded) |
| D9 | No absence for days without any punch; no weekend/holiday/leave awareness | Monthly totals can't distinguish absence from a day off | S13 (only when invoked) |
| D10 | Overtime has no approval and early leave doesn't affect status | Payroll can't rely on these numbers yet | S04, S05 |
| D11 | Late/early/overtime are only computed when **both** IN and OUT exist | A late IN without an OUT shows 0 late minutes | S12 |

---

## 2. Future payroll-grade rules

| Topic | Classification | Current | Proposal / question |
| --- | --- | --- | --- |
| Different employee shifts | EXISTING (partial) + PROPOSED | One shift per day via assignments | Keep assignments as the single source of schedule. Add a **schedule resolver** returning, per employee/day: `WORKING`, `REST_DAY`, `PUBLIC_HOLIDAY`, `LEAVE`, plus the shift. The resolver is versioned and effective-dated. |
| Overnight shifts | HR | D4 | The attendance date = **shift-start date** (recommended). Punches are paired within a shift window, e.g. shift start − 4 h to shift end + 6 h, not by calendar day. HR must confirm the windows. |
| Cross-midnight IN/OUT pairing | PROPOSED | Calendar day only | Pair by shift window (above). An OUT belongs to the most recent open IN within the window. Fixes D4/D5. |
| Weekend (Friday/Saturday) | HR | No concept | **Must be per-employee or per-schedule, never a company-wide override.** A company default weekend calendar applies only where an employee has no schedule saying otherwise; site and shift schedules (e.g. 6-day factory rotations) take precedence. |
| Paid vs unpaid breaks | HR | D2 | Options: (a) fixed `breakMinutes` deducted when worked > N h; (b) punched breaks (`BREAK_START/END`) deducted; (c) paid break, no deduction. Per shift. |
| Grace period | HR | D1 | Options: (a) grace forgives lateness entirely up to N min; (b) grace only suppresses the `LATE` status but minutes are still counted. Also: rounding to whole minutes (truncate vs round). |
| Late arrival | HR | D3, D11 | The threshold for `LATE` status (after grace); count late minutes even without an OUT. |
| Early departure | HR | Counted, no status effect | Should early leave beyond N min produce `HALF_DAY` or an exception? |
| Approved overtime | HR + PROPOSED | D10 | Overtime is **eligible minutes only**; payable overtime = approved request ∩ eligible minutes, with a minimum block (e.g. 15/30 min) and caps. Separate weekday, rest-day and holiday rates are a payroll concern (no amounts here). |
| Working on rest days | HR | Treated as a normal day | Classify as rest-day work: all minutes are overtime-eligible, subject to approval. |
| Public holidays | HR + PROPOSED | No calendar | Add an effective-dated holiday calendar (company or site). Status `HOLIDAY` when there are no punches; holiday work is handled like rest-day work. |
| Approved leave | PROPOSED | Leave module not linked | When an approved leave covers the day → status `LEAVE` (`HALF_DAY` for half-day leave); punches on leave days → exception for HR. |
| Absence with no punches | PROPOSED + HR | D9 | A monthly-close (or nightly) job materialises `ABSENT` only for scheduled `WORKING` days with no eligible punches, **after** checking leave, holidays and rest days. |
| Multiple work sessions per day | HR | Earliest IN / latest OUT (gaps count as worked) | Option: sum paired sessions instead, so the gaps aren't paid. Needs HR policy for split shifts. |
| Employee shift transfers | EXISTING + PROPOSED | Latest overlapping assignment wins (D8) | Enforce non-overlapping assignments per employee in the API (a validation error on overlap); transfers take effect from a date boundary. |
| Biometric sync delay | EXISTING + HR | Device event time is official; a late sync into a locked period is flagged | HR: the maximum sync delay before a punch requires review. A late sync into an open period triggers recalculation automatically (existing). |
| Corrections after missing punches | EXISTING | An approved correction creates an `ACCEPTED_WITH_WARNING` manual punch and recalculates | Keep. Add a correction reason taxonomy for reporting. |
| Payroll-period locking | EXISTING | A locked period refuses recalculation and stores late punches flagged | Keep. Post-lock adjustments go to the next open period as a separately approved adjustment line (HR/Finance). |
| Monthly working-hour totals | PROPOSED | Not implemented (Unit 20.2) | Sum over **finalised** daily summaries: worked, late, early, eligible OT, approved OT, absent days, leave days, holiday days, missing-punch days (unresolved → blocks close). Only approved summaries feed payroll export. |

### Guard-rails for introducing any of the above

1. HR confirms the rule in writing; record the decision in `context/progress-tracker.md` (Decisions).
2. Add a new `rulesetVersion`, and make rules effective-dated: calculations for past dates use the rule version effective then (architecture invariants 13/14).
3. Re-record `summary-v1` (or create `summary-v2`) fixtures from NestJS, review, freeze. Rust must match before any cutover.
4. Never silently recompute locked periods under new rules.

---

## 3. Monthly attendance payroll basis (Unit 20.2 — EXISTING, read-only)

`GET /payroll-attendance/monthly`, `/monthly/summary` and `/monthly/:employeeId` (permission `payrollAttendance.read`). Implementation: `apps/api/src/payroll-attendance/` (pure calculator `monthly-attendance.calculator.ts`, rules version `monthly-attendance-basis/1`).

| Rule | Behaviour |
| --- | --- |
| Source of daily values | Stored `AttendanceDailySummary` rows only; summaries are never recalculated by the report |
| Employment window | Days before `hireDate` / after `terminationDate` are `NOT_EMPLOYED` and excluded |
| Shift per day | Same rule as the daily calculator (latest overlapping assignment). Equal `effectiveFrom` → `SHIFT_ASSIGNMENT_AMBIGUOUS` |
| Required minutes | Gross shift duration (break not deducted). **Only on days the employee attended** (a summary with an official punch) **and** with a valid, unambiguous shift. Never assumed (no default 8 h). |
| Scheduled working days | `null`: the schema has no rest-day, weekly schedule, holiday or leave data, so no company-wide weekend is assumed |
| Assigned day without a summary | `NO_DAILY_SUMMARY` / `MISSING_DAILY_SUMMARY`, reported as missing coverage, **never** absent; required minutes unknown |
| Worked minutes | `recordedWorkedMinutes` = as stored; `workedMinutes` = null on blocking days (e.g. the `MISSING_PUNCH` placeholder 0 is not treated as real work) |
| Shortage | `max(0, required − worked)` per non-blocking day. Lateness is already inside it (late minutes are informational, not added). No netting against overtime across days. Monthly `shortageMinutes`/`requiredMinutes` are `null` unless every employment day is determinable; `verifiedShortageMinutes`/`requiredMinutesDeterminable` give the partial sums. |
| Overtime | Informational only (`overtimeMinutesInformational`) |
| ABSENT rows | Counted in `absentDays`, but flagged `ABSENT_NOT_HR_CONFIRMED` (blocking) |
| Locks | Day `payrollLocked` (a LOCKED period covers it) / `summaryLocked`; month `payrollLock {overlapsLockedPeriod, fullyLocked, lockedDates, lockedSummaryCount}` |

**Blocking day codes** (shortage `null`, month `INCOMPLETE`):
- `NO_SHIFT_ASSIGNMENT`, `SHIFT_ASSIGNMENT_AMBIGUOUS`
- `SHIFT_CONFIGURATION_INVALID` (out of range, start = end, or `isOvernight` with end > start), `SHIFT_INACTIVE`
- `OVERNIGHT_SHIFT_CALENDAR_SPLIT` (D4)
- `MISSING_DAILY_SUMMARY`, `MISSING_PUNCH`, `OUT_BEFORE_IN` (D5)
- `ABSENT_NOT_HR_CONFIRMED`, `PENDING_REVIEW_PUNCHES`, `PENDING_CORRECTION`

**Warning codes** (month `NEEDS_REVIEW`; values still computed):
- `BREAK_NOT_APPLIED` (D2), `GRACE_NOT_APPLIED` (D1)
- `REJECTED_PUNCHES`, `LOCKED_PERIOD_LATE_PUNCH`

**Month codes:** `REST_DAY_CALENDAR_NOT_CONFIGURED`, `NO_EMPLOYMENT_DAYS_IN_PERIOD`.

**Review status precedence:**
1. `LOCKED`: every employment day is locked. A lock is **not** payroll approval, and the exceptions are still listed.
2. `INCOMPLETE`: any blocking day.
3. `NEEDS_REVIEW`: warnings only.
4. `CALCULATED`: no exceptions.

**No status means "payroll approved".** No salary amounts, deductions or payslips exist in the HRMS.

**Consequence until HR decides the rest-day calendar:** any employee with a shift-assigned day without attendance (e.g. every weekend) is `INCOMPLETE`. This is deliberate: the system cannot tell a rest day from an absence.

**Performance** (2,000 employees × 28 days, 56k summaries, 112k punches, local test DB):

| Endpoint | Time |
| --- | --- |
| List page of 100 | 0.23–0.40 s |
| Employee detail | 31 ms |
| Company-wide summary | ≈ 3.9–4.7 s |

- Every request is one `REPEATABLE READ, READ ONLY` transaction, so it reads a consistent snapshot and the database rejects any write.
- Each 250-employee chunk uses a fixed number of queries (no N+1): summaries with an explicit punch join, assignments, a pending-correction `groupBy`, and one SQL punch-count aggregate. These use the existing `(employeeId, workDate)` and employee-prefixed punch indexes.
- There is no caching.
- The aggregate time is split across summary deserialisation (~1.6 s), per-day evaluation (~1.4 s) and the punch aggregate (~0.9 s). The next step, if needed, is SQL-side pre-aggregation.

**HR decisions that would make months payroll-ready:**
- the rest-day / weekend calendar per employee or schedule;
- the holiday calendar and the leave link;
- absence policy for scheduled days without punches;
- grace and break semantics;
- overnight pairing;
- the missing-punch policy;
- overtime approval.

## 4. Payroll closing readiness (Unit 21.1 — EXISTING, enforced at lock time)

**Purpose:** decide whether an exact payroll-lock date range can be locked without freezing attendance that could produce wrong payroll figures. Readiness is **fail-closed**. "Ready" means only that no known blocking issue exists. It is **not** payroll approval, it approves nothing, and it calculates no money.

**Code:**
- `apps/api/src/payroll-locks/payroll-closing-readiness.rules.ts` (pure rules, codes, aggregation);
- `payroll-closing-readiness.service.ts` (bulk loading);
- enforced in `PayrollLocksService.lockPeriod`.
- Rules version: `payroll-closing-readiness/1`.

### 4.1 Scope and date boundaries

- **Exact inclusive range:** `periodStart`..`periodEnd` of the lock row, not whole months (`parseDateRange`).
- **Day boundaries:** Kuwait work days, fixed UTC+3. The range runs [start 00:00 Kuwait, end+1 00:00 Kuwait), and a punch at 00:10 Kuwait belongs to that day.
- **Employees:** everyone employed on at least one day of the range (hire ≤ end, termination null or ≥ start; soft-deactivated employees are included). Only their employment days are evaluated.
- **Day evaluation:** reuses the §3 per-day evaluation, then applies the rules below.

### 4.2 Blocking codes (per employee-day; each code counted once per employee-day)

| Code | Meaning |
| --- | --- |
| `NO_SHIFT_ASSIGNMENT`, `SHIFT_ASSIGNMENT_AMBIGUOUS`, `SHIFT_CONFIGURATION_INVALID`, `SHIFT_INACTIVE` | Shift missing, tied (same `effectiveFrom`), invalid, or inactive |
| `OVERNIGHT_SHIFT_CALENDAR_SPLIT` | Overnight shift (D4 undecided) |
| `WORK_CALENDAR_NOT_CONFIGURED` | No summary, no punches, and **no approved calendar** for the day (classification UNKNOWN). Rest day, holiday, leave or absence cannot be told apart, so the day blocks; it is never assumed absent or a day off |
| `WORK_CALENDAR_CONFLICT` | (HR-POLICY-01) Calendar assignments or day exceptions disagree for the day (§5) |
| `SCHEDULED_DAY_NO_ATTENDANCE` | (HR-POLICY-01) The approved calendar says it was a working day, but there is no attendance. Absence vs unrecorded leave is unresolved; never converted to an absence or a deduction |
| `WORK_ON_NON_WORKING_DAY` | (HR-POLICY-01) Attendance on a verified rest day, public holiday or leave day; the compensation rule is pending (HRP-04) |
| `MISSING_DAILY_SUMMARY` | Punches exist but no summary was calculated |
| `DAILY_SUMMARY_STALE` | The stored summary does not reflect the current inputs (§4.4) |
| `MISSING_IN`, `MISSING_OUT` | `MISSING_PUNCH` summary, split by which side is missing |
| `OUT_BEFORE_IN` | OUT earlier than IN |
| `ABSENT_NOT_HR_CONFIRMED` | ABSENT summary (no HR confirmation step exists) |
| `PENDING_REVIEW_PUNCHES` | Mobile/web/manual punch awaiting HR or manager review |
| `UNRESOLVED_DEVICE_IMPORT` | Biometric/face/card/import/integration punch awaiting review |
| `PENDING_CORRECTION` | Correction not yet approved or rejected |
| `BREAK_NOT_APPLIED`, `GRACE_NOT_APPLIED` | Configured break/grace not applied by the daily calculator (D1/D2). **Blocking for closing**, though only a warning in the §3 report |

**Warnings (do not block):** `REJECTED_PUNCHES`, `LOCKED_PERIOD_LATE_PUNCH`.

**Period-level blockers:**
- `NO_EMPLOYEES_IN_PERIOD`: nothing can be verified, so nothing is locked.
- `PERIOD_TOO_LONG`: more than 92 days. This bounds the evaluation; use monthly periods.

### 4.3 Practical consequence (updated by HR-POLICY-01)

- **What clears a day:** a day with no activity no longer blocks when an **approved** calendar classifies it as a rest day, public holiday or approved leave (§5).
- **What still blocks:**
  - UNKNOWN days (no approved calendar applies);
  - scheduled working days without attendance;
  - work on a non-working day;
  - calendar conflicts;
  - every attendance and correction exception.
- **On dev today:** no calendar has been approved, so behaviour is unchanged from Unit 21.1 until HR enters and approves real calendars. Approved leave is not integrated (no leave module).

Shifts with a break or grace period also block (D1/D2). This is intentional, and there is **no override** of any kind: no force flag, no bypass parameter, no privileged role, SUPER_ADMIN included.

### 4.4 Freshness (`DAILY_SUMMARY_STALE`) — checked by content, not clocks

A summary is stale when any of these holds:
- its official IN is not the earliest eligible (`ACCEPTED` / `ACCEPTED_WITH_WARNING`) IN of that Kuwait day;
- its official OUT is not the latest eligible OUT (the daily calculator's own selection rule);
- an official punch is no longer eligible;
- a covering shift assignment or shift has `updatedAt > calculatedAt`.

**Why not timestamps for punches:** Prisma/PostgreSQL and Node stamp times with clocks of different granularity on Windows (observed in testing: a punch created *before* a summary appeared newer). Worse, a punch committing during a recalculation could carry an *earlier* timestamp than the summary it is missing from. The content check has neither problem.

### 4.5 Lock coordination (TIME-01 scheme, extended)

`lockPeriod` runs in one READ COMMITTED transaction:
1. `SELECT … FOR UPDATE` on the period row. This waits for every in-flight writer holding `FOR SHARE` on that row.
2. Re-check the status.
3. Evaluate readiness on the same transaction. Every statement sees everything committed before it.
4. If ready, stamp `lockedAt` on the summaries, mark the period LOCKED, and commit. If not, throw: the transaction rolls back, a `PAYROLL_PERIOD_LOCK_REFUSED_NOT_READY` audit row is written, and the API returns `409 PAYROLL_PERIOD_NOT_READY`.

The lock transaction has a 120 s timeout.

**How each concurrent write is handled:**

| Writer | Coordination |
| --- | --- |
| Summary recalculation | `FOR SHARE` in its transaction (TIME-01). It either commits before the lock reads, or waits, then sees LOCKED and refuses. |
| Correction approval | **Fixed in 21.1.** The lock re-check moved *inside* the approval transaction (`FOR SHARE`); previously it ran before it, so a correction could be approved inside a just-locked period. If approval commits but its follow-up recalculation has not run, readiness sees `DAILY_SUMMARY_STALE` or `MISSING_DAILY_SUMMARY` and refuses. |
| New punch / validation decision | Not row-locked. These are safe because readiness fails closed. A PENDING punch is seen as pending; an ACCEPTED punch the summary has not absorbed is seen as stale; a punch committed after the readiness reads is ordered after the lock and is flagged `LOCKED_PERIOD_LATE_PUNCH` by the existing intake path. |
| Correction request, correction rejection | Only add or remove a blocker. Seen → blocks; not seen → ordered after the lock. |
| Shift / assignment / employee edits | No API exists. Direct database edits are caught by the `updatedAt > calculatedAt` check when committed before the read. Otherwise they are ordered after the lock and do not alter frozen summaries. |

**Limits:**
- While the lock evaluates (about 8–12 s at 2,000 employees × 28 days on the dev machine), recalculations and approvals for dates in that period wait. Their transaction timeout is 20 s.
- Locking is a month-end action on past dates, so contention is expected to be rare; this is recorded as a monitoring point.

### 4.6 Remaining HR decisions that keep periods not-ready

- **The working calendar:** rest days, holidays and leave (HR-POLICY unit).
- **D1 grace and D2 breaks.**
- **D4 overnight shifts.**
- **Absence confirmation.**
- **Lock override:** any future override needs formal HR/management approval and a separate audited design.

## 5. Working calendar (HR-POLICY-01 — EXISTING foundation; NOT payroll-ready until HR approves real calendars)

**Code:**
- `apps/api/src/work-calendars/`: `work-calendar.resolver.ts` (pure), `work-calendar.loader.ts` (bulk), service, controllers.
- Resolver version: `work-calendar-resolver/1`.
- **Rules versions bumped** because the day evaluation now uses the calendar: `monthly-attendance-basis/2`, `payroll-closing-readiness/2`.
- The open HR decisions are in `docs/architecture/hr-policy-decision-register.md`.

### 5.1 Data model (additive migration `20261109090000_hr_policy_01_working_calendar`)

| Table | Holds |
|---|---|
| `work_calendars` | A weekly pattern (`workingWeekdays`, 0 = Sunday … 6 = Saturday) with status DRAFT → ACTIVE. ACTIVE needs `approvalReference` and `activatedAt` (CHECK constraint). **ACTIVE calendars are immutable.** |
| `work_calendar_assignments` | Which calendar applies, by scope **EMPLOYEE** or **SHIFT**, for an inclusive date range. Never deleted: ending sets `effectiveTo` plus who and when. Only ACTIVE calendars can be assigned, and overlaps in the same scope are refused at entry. |
| `work_calendar_day_overrides` | One date becomes a WORKING_DAY or a REST_DAY, for a calendar or for an employee (exactly one, CHECK). DRAFT → ACTIVE (approval) → INACTIVE (with a reason). |
| `public_holidays` | Company-wide inclusive date ranges. DRAFT → ACTIVE (approval **and** a recorded `source`, CHECK) → INACTIVE (with a reason). |

**Constraints:**
- Foreign keys are `ON DELETE RESTRICT`, so history can never be orphaned.
- Location-specific holidays and calendars are **not** modelled, because location history is not tracked (HRP-08).

### 5.2 Resolution per employee and Kuwait date (only ACTIVE records are loaded)

| Precedence | Source | Result |
|---|---|---|
| 1 | Outside hire..termination | `NOT_EMPLOYED` |
| 2 | Approved leave | `APPROVED_LEAVE`. **Not integrated** (no leave module); never produced |
| 3 | Employee day override | `SCHEDULED_WORKDAY` / `REST_DAY` |
| 4 | Public holiday | `PUBLIC_HOLIDAY` (plus `HOLIDAY_ON_REST_DAY` when the pattern says rest) |
| 5 | Calendar day override | `SCHEDULED_WORKDAY` / `REST_DAY` |
| 6 | Weekly pattern of the EMPLOYEE calendar, else the SHIFT calendar of the effective shift | `SCHEDULED_WORKDAY` / `REST_DAY` |
| 7 | Nothing | `UNKNOWN` (`NO_CALENDAR_ASSIGNED`) |

**Same-level conflicts** make the day `UNKNOWN`, with one of:
- two different calendars from EMPLOYEE assignments, or from SHIFT assignments;
- two shifts on the same date;
- an employee or calendar day override disagreeing with another for the same date.

The resolver never picks one of them.

**Scheduled minutes:**
- **Scheduled day:** the shift duration, or `null` with `SCHEDULED_MINUTES_UNKNOWN`.
- **Verified non-working day:** 0.
- **UNKNOWN or not employed:** `null`. Never 0 for unknown.

**Overnight shifts:** owned by the start date; flagged `OVERNIGHT_SHIFT_OWNERSHIP_PENDING` (HRP-09).

### 5.3 Effect on the monthly report (§3)

**Day level:**

| Day | Coverage | Required | Worked / shortage | Exception |
|---|---|---|---|---|
| Verified rest day, holiday or leave, no attendance | `NON_WORKING_DAY` (no shift needed) | 0 | 0 / 0 | none |
| Scheduled day, no attendance | as before | shift length | `null` | `SCHEDULED_DAY_NO_ATTENDANCE` (blocking). Never ABSENT, never a deduction |
| Attendance on a non-working day | — | `null` | — | `WORK_ON_NON_WORKING_DAY` (blocking) |
| Calendar conflict | — | — | — | `WORK_CALENDAR_CONFLICT` (blocking) |
| UNKNOWN | **unchanged from Unit 20.2** | — | — | — |

**Month level:**
- `days.scheduledWorkingDays` is a number only when no employment day is UNKNOWN.
- New counts: `restDays`, `publicHolidayDays`, `approvedLeaveDays`, `unknownCalendarDays`.
- `REST_DAY_CALENDAR_NOT_CONFIGURED` now refers only to UNKNOWN days.
- Totals stay `null` while any day is unresolved.

### 5.4 Locked periods and concurrency

Every change that alters a date's classification runs `PayrollLockGuardService.assertDateRangeNotLockedInTransaction` inside its own write transaction. That takes `FOR SHARE` on every overlapping payroll-lock row and refuses (409) if any is LOCKED.

**Changes covered:**
- creating an assignment (its range);
- ending one (the days after the new end);
- activating or deactivating a holiday (its range);
- activating or deactivating an override (its date).

**How it serialises with `lockPeriod`'s `FOR UPDATE`**, the same scheme as summary recalculation:
- **Change commits first:** the lock's readiness evaluates the new classification.
- **Lock commits first:** the change waits, then is refused.

Locked periods therefore cannot be re-classified; reopening (with a reason) is the only path. Calendar activation and draft edits change no classification, so they need no lock check. Proven by deterministic race tests and a mutation check.

### 5.5 Not built (scope)

- No leave module.
- No absence confirmation.
- No holiday or rest-day compensation.
- No location-history model.
- No import of holiday calendars from external sources.
- No HR policy entered on dev.

