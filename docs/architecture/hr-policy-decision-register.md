# HR Policy Decision Register — Working Calendar (HR-POLICY-01)

**Status of every item below: PENDING HR / management decision.**

**What is built today:**
- The system implements a *mechanism*. No RECAFCO policy has been entered or activated: no calendar, holiday or exception exists in any database.
- Every record a decision produces must be entered by HR as a **DRAFT** and then **approved** (activated with an approval reference) by a holder of `workCalendars.activate`.
- Drafts are never used by attendance, monthly reporting or payroll closing. The database itself refuses an ACTIVE row without approval facts (CHECK constraints).

**Format of each entry:** question · what the system does until decided · what the decision unlocks.

| ID | Decision needed | Until decided (current, fail-closed) | Unlocks |
|---|---|---|---|
| HRP-01 | **Rest-day defaults:** the weekly pattern(s) per site, shift or employee group (e.g. Sun–Thu, six-day sites, rotating rosters) | No weekend is assumed for anyone. Days without an approved calendar are `UNKNOWN` and block payroll closing (`WORK_CALENDAR_NOT_CONFIGURED`) | HR creates one DRAFT calendar per approved pattern and approves it |
| HRP-02 | **Who may approve and assign calendars** (activate calendars/holidays/exceptions; assign or end assignments) | `workCalendars.activate` = **SUPER_ADMIN only**. HR_ADMIN/HR_MANAGER can only create DRAFTS (`workCalendars.manage`). Read access: HR roles, PAYROLL_OFFICER, AUDITOR, MANAGEMENT_VIEWER | Grant `workCalendars.activate` to the approved role(s) in `rbac.constants.ts` + bootstrap |
| HRP-03 | **Holiday administration:** who maintains the list, the official source (e.g. a Civil Service Bureau circular), lead time, and handling of moved or announced-late holidays | Holidays are entered manually as DRAFT. Activation requires a recorded `source` and approval reference. **Nothing is generated or imported automatically**; no external calendar is used | HR enters and approves each year's holidays |
| HRP-04 | **Holiday compensation:** pay or time-off for work on a public holiday; a holiday that falls on a rest day (replacement day?) | Work on a holiday or rest day → `WORK_ON_NON_WORKING_DAY` (blocking). A holiday on a rest day is flagged `HOLIDAY_ON_REST_DAY`; no replacement day is created | A compensation rule (separate unit) |
| HRP-05 | **Approved-leave source:** which system is authoritative for approved leave (a future HRMS leave module? an external HR system?) and its interface | **No leave module exists.** `APPROVED_LEAVE` is never produced. A scheduled day without attendance stays `SCHEDULED_DAY_NO_ATTENDANCE` (blocking); it is never treated as absent or as leave. `Employee.status = ON_LEAVE` is ignored (it has no dates) | The leave module, which provides `ApprovedLeaveProvider` (dates, type, approval reference, approver) |
| HRP-06 | **Conflicting schedules:** e.g. a person on two calendars, or two different exceptions on one date | Same-level conflicts make the day `UNKNOWN` with a conflict code (blocking). Overlapping assignments are refused at entry and never auto-resolved | Confirmation of the precedence below, or a different rule |
| HRP-07 | **Effective-date handling:** may calendars change mid-month? Retroactive changes? | Allowed with any effective date **outside locked payroll periods**. Approved calendars are immutable; a change = a new calendar plus re-assignment from a date | Confirmation, or stricter rules (e.g. month-start only) |
| HRP-08 | **Work-location calendars and transfers** | No location history is stored, so there is no location-scoped calendar. "Assign to all at a location" creates dated per-employee rows (which ARE the history). Transfers = end one assignment and start another | A location-history model, if location-scoped rules are wanted |
| HRP-09 | **Overnight shift ownership:** which calendar date a night shift belongs to | The resolver uses the **shift start date** and flags `OVERNIGHT_SHIFT_OWNERSHIP_PENDING`. The daily calculator still blocks overnight shifts (D4, `OVERNIGHT_SHIFT_CALENDAR_SPLIT`) | D4 decision (`shift-payroll-rules.md` §2) |
| HRP-10 | **Absence policy:** when a scheduled day without attendance becomes a confirmed absence, and who confirms | Never automatic. Blocks closing. No deduction exists anywhere | An absence-confirmation workflow (separate unit) |

**Precedence implemented** (subject to HRP-06; detailed in `shift-payroll-rules.md` §5):
1. Employment dates.
2. Approved leave (not integrated).
3. Employee day exception.
4. Public holiday.
5. Calendar day exception.
6. The weekly pattern of the employee's calendar; if the employee has none, the calendar of their shift.
7. UNKNOWN.
