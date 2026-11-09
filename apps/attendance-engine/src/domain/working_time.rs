//! Worked / late / early-leave / overtime minutes — mirrors `calculateMinutes`.
//!
//! Every value is `max(0, Math.round(deltaMilliseconds / 60000))` with JavaScript rounding
//! (halves toward +∞): 30 s late rounds to 1 minute, 29.999 s to 0.
//! * Missing IN or OUT → all four values 0.
//! * No shift → only total worked minutes.
//! * Late = IN − shift start; early leave = shift end − OUT; overtime = OUT − shift end.
//!   Grace period and breaks are NOT applied; early arrival is not overtime; overtime needs no
//!   approval (existing behaviour).

use chrono::{DateTime, Utc};

use super::geo::js_round;
use super::shift::{ShiftContext, shift_window};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct WorkingMinutes {
    pub total_worked: i64,
    pub late: i64,
    pub early_leave: i64,
    pub overtime: i64,
}

/// `Math.max(0, Math.round((later - earlier) / 60_000))` on millisecond timestamps.
fn rounded_minutes(later: DateTime<Utc>, earlier: DateTime<Utc>) -> i64 {
    let delta_ms = (later.timestamp_millis() - earlier.timestamp_millis()) as f64;
    (js_round(delta_ms / 60_000.0) as i64).max(0)
}

pub fn calculate_minutes(
    official_in: Option<DateTime<Utc>>,
    official_out: Option<DateTime<Utc>>,
    shift: Option<&ShiftContext>,
    day_start: DateTime<Utc>,
) -> WorkingMinutes {
    let (Some(time_in), Some(time_out)) = (official_in, official_out) else {
        return WorkingMinutes::default();
    };
    let total_worked = rounded_minutes(time_out, time_in);
    let Some(shift) = shift else {
        return WorkingMinutes {
            total_worked,
            ..WorkingMinutes::default()
        };
    };
    let (shift_start, shift_end) = shift_window(shift, day_start);
    WorkingMinutes {
        total_worked,
        late: rounded_minutes(time_in, shift_start),
        early_leave: rounded_minutes(shift_end, time_out),
        overtime: rounded_minutes(time_out, shift_end),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn half_minute_rounds_up_like_javascript() {
        assert_eq!(
            rounded_minutes(at("2026-11-08T04:00:30Z"), at("2026-11-08T04:00:00Z")),
            1
        );
        assert_eq!(
            rounded_minutes(at("2026-11-08T04:00:29.999Z"), at("2026-11-08T04:00:00Z")),
            0
        );
        assert_eq!(
            rounded_minutes(at("2026-11-08T04:00:00Z"), at("2026-11-08T04:05:00Z")),
            0
        );
    }
}
