//! Source-scoped idempotency keys (RUST-04).
//!
//! A raw device log number is NOT globally unique: devices number their own logs, numbers can
//! repeat across devices and may restart after a device reset. RUST-02 fixture V44 shows the
//! current NestJS duplicate rule matches `sourceId` across devices and time, so passing a raw log
//! number as `sourceId` would wrongly reject a second device's event. Every key therefore carries
//! its full scope. Preference order, chosen per source once its schema is confirmed:
//!
//! 1. `bio:{source}:dev:{serial}:log:{device_local_event_id}:{event_utc_ms}` — the device log
//!    number scoped to its device; the event instant is appended so a log number reused after a
//!    device reset (different time) yields a new key while a re-read of the same row does not.
//! 2. `bio:{source}:row:{source_row_id}` — the source database's own primary key.
//! 3. `bio:{source}:dev:{serial}:emp:{enrollment}:{event_utc_ms}:{direction_raw}` — content key
//!    when the source has no identifiers at all (two genuinely identical scans in the same
//!    millisecond collapse, which is the intended behaviour).

use chrono::{DateTime, Utc};

use super::model::SourceEvent;

pub fn idempotency_key(event: &SourceEvent, event_utc: Option<DateTime<Utc>>) -> String {
    let source = &event.source_system;
    let serial = event.device_serial.as_deref().unwrap_or("-");
    let millis = event_utc.map_or_else(|| "-".to_owned(), |t| t.timestamp_millis().to_string());

    if let Some(log) = event
        .device_local_event_id
        .as_deref()
        .filter(|s| !s.is_empty())
    {
        return format!("bio:{source}:dev:{serial}:log:{log}:{millis}");
    }
    if let Some(row) = event.source_row_id.as_deref().filter(|s| !s.is_empty()) {
        return format!("bio:{source}:row:{row}");
    }
    let direction = event.direction_raw.as_deref().unwrap_or("-");
    format!(
        "bio:{source}:dev:{serial}:emp:{}:{millis}:{direction}",
        event.enrollment_number
    )
}
