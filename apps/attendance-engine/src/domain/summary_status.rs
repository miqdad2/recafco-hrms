//! Daily status — mirrors `determineStatus`.
//! IN and OUT → LATE if late minutes > 0, else PRESENT (early leave does not affect status);
//! exactly one of them → MISSING_PUNCH; neither → ABSENT.
//! WEEK_OFF / HOLIDAY / LEAVE / HALF_DAY are never produced by the current calculator.

use super::types::DailyAttendanceStatus;

pub fn determine_status(has_in: bool, has_out: bool, late_minutes: i64) -> DailyAttendanceStatus {
    match (has_in, has_out) {
        (true, true) if late_minutes > 0 => DailyAttendanceStatus::Late,
        (true, true) => DailyAttendanceStatus::Present,
        (true, false) | (false, true) => DailyAttendanceStatus::MissingPunch,
        (false, false) => DailyAttendanceStatus::Absent,
    }
}
