//! Event-time normalisation and sync-delay / clock checks (RUST-04).
//!
//! * The ORIGINAL device event time becomes the official instant (`punchTimeSource`). Import/sync
//!   time is recorded separately and never substituted.
//! * A source-provided absolute instant wins; otherwise device-local wall-clock time is converted
//!   with the device's configured UTC offset (never the connector host's timezone).
//! * Delayed sync is flagged (information only).
//! * An event time later than the moment the source recorded it (beyond a tolerance) proves the
//!   device clock is ahead; such events are held, not imported with a wrong time.
//!   A device clock that is BEHIND cannot be detected from a single event — that needs periodic
//!   device-clock monitoring (see biometric-integration.md).

use chrono::{DateTime, Duration, Utc};

use super::model::{DeviceRegistration, SourceEvent};

pub const DELAYED_SYNC_FLAG_MINUTES: i64 = 30;
pub const CLOCK_AHEAD_TOLERANCE_MINUTES: i64 = 5;

pub fn event_time_utc(
    event: &SourceEvent,
    device: Option<&DeviceRegistration>,
) -> Option<DateTime<Utc>> {
    if let Some(utc) = event.event_time_utc {
        return Some(utc);
    }
    let local = event.event_time_local?;
    let offset = Duration::minutes(i64::from(device?.utc_offset_minutes));
    Some(local.and_utc() - offset)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimingAssessment {
    /// Delay between the event and the moment the connector saw it.
    pub sync_delay: Duration,
    pub delayed: bool,
    pub clock_ahead: bool,
}

pub fn assess_timing(
    event_utc: DateTime<Utc>,
    source_recorded_at: Option<DateTime<Utc>>,
    synced_at: DateTime<Utc>,
) -> TimingAssessment {
    let observed = source_recorded_at.unwrap_or(synced_at);
    let sync_delay = synced_at - event_utc;
    TimingAssessment {
        sync_delay,
        delayed: sync_delay > Duration::minutes(DELAYED_SYNC_FLAG_MINUTES),
        clock_ahead: event_utc > observed + Duration::minutes(CLOCK_AHEAD_TOLERANCE_MINUTES),
    }
}
