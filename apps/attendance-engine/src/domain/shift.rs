//! Shift resolution and shift boundaries — mirrors `findActiveShift` and the shift part of
//! `calculateMinutes` in `AttendanceSummaryCalculatorService`.
//!
//! Existing behaviour reproduced exactly (see docs/architecture/shift-payroll-rules.md):
//! * An assignment applies when it overlaps any part of the Kuwait work day:
//!   `effectiveFrom < dayEnd && (effectiveTo == null || effectiveTo >= dayStart)`.
//! * The applicable assignment with the LATEST `effectiveFrom` wins. Ties on `effectiveFrom` are
//!   undefined in NestJS (database order) — the caller must not supply ties.
//! * `Shift.isActive` is NOT consulted (an inactive shift still applies).
//! * `gracePeriodMinutes` and `breakMinutes` are carried but NOT applied.
//! * A shift is treated as overnight when `isOvernight` OR `endTimeMinutes <= startTimeMinutes`;
//!   its end is then placed on the next calendar day, but punches are still grouped by the
//!   Kuwait calendar day of the IN date (no cross-midnight pairing).

use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShiftContext {
    pub id: String,
    pub start_time_minutes: i64,
    pub end_time_minutes: i64,
    pub is_overnight: bool,
    /// Stored, not applied by the current calculator.
    #[serde(default)]
    pub grace_period_minutes: i64,
    /// Stored, not applied by the current calculator.
    #[serde(default)]
    pub break_minutes: i64,
    /// Stored, not consulted by the current calculator.
    #[serde(default = "default_true")]
    pub is_active: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShiftAssignmentContext {
    pub id: String,
    pub effective_from: DateTime<Utc>,
    #[serde(default)]
    pub effective_to: Option<DateTime<Utc>>,
    pub shift: ShiftContext,
}

/// The shift applying to the Kuwait day `[day_start, day_end)`, if any.
pub fn find_active_shift(
    assignments: &[ShiftAssignmentContext],
    day_start: DateTime<Utc>,
    day_end: DateTime<Utc>,
) -> Option<&ShiftContext> {
    assignments
        .iter()
        .filter(|a| a.effective_from < day_end && a.effective_to.is_none_or(|to| to >= day_start))
        .max_by_key(|a| a.effective_from)
        .map(|a| &a.shift)
}

/// Absolute shift start/end instants for the work day starting at `day_start`.
pub fn shift_window(
    shift: &ShiftContext,
    day_start: DateTime<Utc>,
) -> (DateTime<Utc>, DateTime<Utc>) {
    let end_minutes = if shift.is_overnight || shift.end_time_minutes <= shift.start_time_minutes {
        shift.end_time_minutes + 24 * 60
    } else {
        shift.end_time_minutes
    };
    (
        day_start + Duration::minutes(shift.start_time_minutes),
        day_start + Duration::minutes(end_minutes),
    )
}
