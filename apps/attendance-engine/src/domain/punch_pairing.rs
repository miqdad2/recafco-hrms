//! Official IN/OUT selection — mirrors `getEligiblePunches` + `chooseOfficialInOut`.
//!
//! * Eligible = `ACCEPTED` or `ACCEPTED_WITH_WARNING` (every pending, rejected and duplicate
//!   status is excluded) AND `punchTimeSource` within the Kuwait day `[start, end)`.
//! * Official IN = earliest eligible `IN`; official OUT = latest eligible `OUT`.
//! * Source-agnostic: mobile and biometric punches compete on time alone, so all four
//!   mobile/biometric IN/OUT combinations work and each punch keeps its own source.
//! * `BREAK_START`/`BREAK_END` are ignored.
//! * No check that the OUT is after the IN (existing behaviour; see shift-payroll-rules.md).
//! * Equal timestamps: NestJS orders by `punchTimeSource` only, so ties are database-order
//!   dependent. This port keeps input order for ties; fixtures avoid ties.

use chrono::{DateTime, Utc};
use serde::Deserialize;

use super::types::{AttendanceSourceType, PunchType, PunchValidationStatus};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SummaryPunch {
    pub id: String,
    pub punch_type: PunchType,
    pub source_type: AttendanceSourceType,
    pub validation_status: PunchValidationStatus,
    /// Trusted official instant (server receipt for mobile, device event time for biometric).
    pub punch_time_source: DateTime<Utc>,
    /// `isOfficial` before this calculation.
    #[serde(default)]
    pub is_official: bool,
}

pub fn in_day(punch: &SummaryPunch, day_start: DateTime<Utc>, day_end: DateTime<Utc>) -> bool {
    punch.punch_time_source >= day_start && punch.punch_time_source < day_end
}

/// Eligible punches of the day, ordered by official instant (stable for ties).
pub fn eligible_punches(
    punches: &[SummaryPunch],
    day_start: DateTime<Utc>,
    day_end: DateTime<Utc>,
) -> Vec<&SummaryPunch> {
    let mut eligible: Vec<&SummaryPunch> = punches
        .iter()
        .filter(|p| p.validation_status.is_accepted() && in_day(p, day_start, day_end))
        .collect();
    eligible.sort_by_key(|p| p.punch_time_source);
    eligible
}

pub fn choose_official_in_out<'a>(
    eligible: &[&'a SummaryPunch],
) -> (Option<&'a SummaryPunch>, Option<&'a SummaryPunch>) {
    let official_in = eligible
        .iter()
        .find(|p| p.punch_type == PunchType::In)
        .copied();
    let official_out = eligible
        .iter()
        .rev()
        .find(|p| p.punch_type == PunchType::Out)
        .copied();
    (official_in, official_out)
}
