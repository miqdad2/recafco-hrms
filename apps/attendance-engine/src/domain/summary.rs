//! Daily attendance summary — a pure port of `AttendanceSummaryCalculatorService
//! .calculateForEmployeeDate` (post-TIME-01): lock refusals, eligible-punch selection, official
//! IN/OUT, shift, minutes, status, calculation version and the resulting `isOfficial` flags.
//!
//! Pure: no clock (`calculatedAt` is not part of the contract), no database, no writes.

use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

use super::punch_pairing::{SummaryPunch, choose_official_in_out, eligible_punches, in_day};
use super::shift::{ShiftAssignmentContext, find_active_shift};
use super::summary_status::determine_status;
use super::time::{KUWAIT_UTC_OFFSET_HOURS, to_iso_millis};
use super::types::{AttendanceSourceType, DailyAttendanceStatus};
use super::working_time::calculate_minutes;

pub const SUMMARY_RESULT_CONTRACT_VERSION: &str = "attendance-daily-summary-result/1";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExistingSummary {
    pub calculation_version: i64,
    /// `lockedAt IS NOT NULL` on the stored summary.
    pub locked: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SummaryInput {
    pub employee_id: String,
    /// Kuwait work date `YYYY-MM-DD`.
    pub work_date: NaiveDate,
    /// The employee's punches around the day (out-of-day punches are ignored except that their
    /// `isOfficial` flag is left untouched, exactly like NestJS).
    #[serde(default)]
    pub punches: Vec<SummaryPunch>,
    #[serde(default)]
    pub shift_assignments: Vec<ShiftAssignmentContext>,
    #[serde(default)]
    pub existing_summary: Option<ExistingSummary>,
    /// A LOCKED payroll period covers `work_date`.
    #[serde(default)]
    pub period_locked: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SummaryOutcomeKind {
    Calculated,
    /// NestJS: `ConflictException('This date falls inside a locked payroll period …')`.
    RefusedLockedPeriod,
    /// NestJS: `ConflictException('Cannot recalculate a locked attendance summary')`.
    RefusedLockedSummary,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryOutcome {
    pub outcome: SummaryOutcomeKind,
    pub official_in_punch_id: Option<String>,
    pub official_out_punch_id: Option<String>,
    pub official_in_time: Option<String>,
    pub official_out_time: Option<String>,
    pub official_in_source_type: Option<AttendanceSourceType>,
    pub official_out_source_type: Option<AttendanceSourceType>,
    pub total_worked_minutes: Option<i64>,
    pub late_minutes: Option<i64>,
    pub early_leave_minutes: Option<i64>,
    pub overtime_minutes: Option<i64>,
    pub status: Option<DailyAttendanceStatus>,
    pub calculation_version: Option<i64>,
    /// Every punch with `isOfficial = true` after the calculation (sorted ids). On refusal this
    /// is the unchanged prior state.
    pub official_punch_ids: Vec<String>,
}

/// `[start, end)` UTC instants of the Kuwait calendar day — `kuwaitWorkDateRange`.
pub fn kuwait_day_range(work_date: NaiveDate) -> (DateTime<Utc>, DateTime<Utc>) {
    let midnight_utc = work_date
        .and_hms_opt(0, 0, 0)
        .expect("valid midnight")
        .and_utc();
    let start = midnight_utc - Duration::hours(KUWAIT_UTC_OFFSET_HOURS);
    (start, start + Duration::hours(24))
}

fn sorted_official_ids<'a>(ids: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut ids: Vec<String> = ids.map(str::to_owned).collect();
    ids.sort();
    ids
}

fn refused(kind: SummaryOutcomeKind, input: &SummaryInput) -> SummaryOutcome {
    SummaryOutcome {
        outcome: kind,
        official_in_punch_id: None,
        official_out_punch_id: None,
        official_in_time: None,
        official_out_time: None,
        official_in_source_type: None,
        official_out_source_type: None,
        total_worked_minutes: None,
        late_minutes: None,
        early_leave_minutes: None,
        overtime_minutes: None,
        status: None,
        calculation_version: None,
        official_punch_ids: sorted_official_ids(
            input
                .punches
                .iter()
                .filter(|p| p.is_official)
                .map(|p| p.id.as_str()),
        ),
    }
}

pub fn calculate_daily_summary(input: &SummaryInput) -> SummaryOutcome {
    // Lock checks happen before any read/write, in the NestJS order.
    if input.period_locked {
        return refused(SummaryOutcomeKind::RefusedLockedPeriod, input);
    }
    if input.existing_summary.as_ref().is_some_and(|s| s.locked) {
        return refused(SummaryOutcomeKind::RefusedLockedSummary, input);
    }

    let (day_start, day_end) = kuwait_day_range(input.work_date);
    let eligible = eligible_punches(&input.punches, day_start, day_end);
    let (official_in, official_out) = choose_official_in_out(&eligible);
    let shift = find_active_shift(&input.shift_assignments, day_start, day_end);
    let minutes = calculate_minutes(
        official_in.map(|p| p.punch_time_source),
        official_out.map(|p| p.punch_time_source),
        shift,
        day_start,
    );
    let status = determine_status(official_in.is_some(), official_out.is_some(), minutes.late);

    // updateOfficialFlags: within the day, exactly the chosen IN/OUT are official; punches
    // outside the day keep their previous flag.
    let keep = [
        official_in.map(|p| p.id.as_str()),
        official_out.map(|p| p.id.as_str()),
    ];
    let official_ids = input.punches.iter().filter_map(|p| {
        let official = if in_day(p, day_start, day_end) {
            keep.contains(&Some(p.id.as_str()))
        } else {
            p.is_official
        };
        official.then_some(p.id.as_str())
    });

    SummaryOutcome {
        outcome: SummaryOutcomeKind::Calculated,
        official_in_punch_id: official_in.map(|p| p.id.clone()),
        official_out_punch_id: official_out.map(|p| p.id.clone()),
        official_in_time: official_in.map(|p| to_iso_millis(p.punch_time_source)),
        official_out_time: official_out.map(|p| to_iso_millis(p.punch_time_source)),
        official_in_source_type: official_in.map(|p| p.source_type),
        official_out_source_type: official_out.map(|p| p.source_type),
        total_worked_minutes: Some(minutes.total_worked),
        late_minutes: Some(minutes.late),
        early_leave_minutes: Some(minutes.early_leave),
        overtime_minutes: Some(minutes.overtime),
        status: Some(status),
        calculation_version: Some(
            input
                .existing_summary
                .as_ref()
                .map_or(0, |s| s.calculation_version)
                + 1,
        ),
        official_punch_ids: sorted_official_ids(official_ids),
    }
}
