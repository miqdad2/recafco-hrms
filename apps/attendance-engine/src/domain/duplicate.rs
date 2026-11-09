//! Duplicate detection — mirrors `AttendanceValidationService.resolveDuplicateOriginal`.
//!
//! Existing NestJS behaviour reproduced exactly (not policy decisions made here):
//! * An explicit `duplicateOfPunchId` short-circuits: the punch is a duplicate iff that punch
//!   exists; the time window is then NOT consulted.
//! * Otherwise a candidate must be ordered before this punch by `(createdAt, id)` (TIME-01
//!   tie-break), share employee, `punchType` and `sourceType`, and EITHER fall within
//!   ±`DUPLICATE_WINDOW_MINUTES` (inclusive) of `punchTimeSource` OR share a non-empty `sourceId`.
//! * The candidate's own validation status is ignored (a rejected earlier punch still counts).
//! * The earliest qualifying candidate is the "original".

use chrono::Duration;

use super::input::ValidationInput;

pub const DUPLICATE_WINDOW_MINUTES: i64 = 2;

/// Returns the id of the original punch if this punch is a duplicate.
/// `input.earlier_punches` must be ordered ascending by `(createdAt, id)`.
pub fn resolve_duplicate_original(input: &ValidationInput) -> Option<String> {
    let punch = &input.punch;

    if let Some(linked) = &punch.duplicate_of_punch_id {
        let exists = input.earlier_punches.iter().any(|p| &p.id == linked)
            || input.other_existing_punch_ids.contains(linked);
        return exists.then(|| linked.clone());
    }

    let window = Duration::minutes(DUPLICATE_WINDOW_MINUTES);
    let window_start = punch.punch_time_source - window;
    let window_end = punch.punch_time_source + window;
    let own_source_id = punch.source_id.as_deref().filter(|s| !s.is_empty());

    input
        .earlier_punches
        .iter()
        .filter(|p| {
            p.id != punch.id
                && p.punch_type == punch.punch_type
                && p.source_type == punch.source_type
        })
        .find(|p| {
            let in_window =
                p.punch_time_source >= window_start && p.punch_time_source <= window_end;
            let same_source_id = own_source_id.is_some() && p.source_id.as_deref() == own_source_id;
            in_window || same_source_id
        })
        .map(|p| p.id.clone())
}
