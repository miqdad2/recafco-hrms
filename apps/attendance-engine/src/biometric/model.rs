//! Source-agnostic data model for the biometric attendance connector (RUST-04).
//!
//! The source database technology is NOT yet confirmed by RECAFCO IT, so nothing here assumes a
//! vendor or engine. A vendor-specific reader (SQL Server, MySQL, PostgreSQL, file export, SDK…)
//! maps its rows into `SourceEvent`; everything downstream is pure and testable.
//!
//! Data minimisation: `SourceEvent` has NO field for fingerprint/face/card templates or images, and
//! rejects unknown fields on deserialisation, so a reader cannot accidentally pass biometric
//! templates through.

use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::domain::types::PunchType;

/// One attendance event as read (read-only) from the biometric source.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceEvent {
    /// Logical source system, e.g. "site-a-biometric-db". Configured, never guessed.
    pub source_system: String,
    /// Monotonic source position used as the sync cursor (e.g. an identity/auto-increment
    /// primary key). `None` when the source has no usable sequence (see timestamp cursor).
    pub source_sequence: Option<i64>,
    /// The source table's primary key, if any (often == source_sequence).
    pub source_row_id: Option<String>,
    /// Physical device identity as recorded by the source (serial number / terminal id).
    pub device_serial: Option<String>,
    /// The device's own log/event number, if the source stores one.
    pub device_local_event_id: Option<String>,
    /// The enrolment / device user number as stored by the source — NOT assumed to equal the
    /// HRMS employeeCode.
    pub enrollment_number: String,
    /// Event time as recorded by the device, in the device's local wall-clock time.
    pub event_time_local: Option<NaiveDateTime>,
    /// Event time as an absolute instant, if the source stores one.
    pub event_time_utc: Option<DateTime<Utc>>,
    /// Raw direction value exactly as stored (e.g. "0"/"1", "I"/"O", "check-in"), if any.
    pub direction_raw: Option<String>,
    /// When the source database recorded the row (its own insertion/upload time), if available.
    pub source_recorded_at: Option<DateTime<Utc>>,
    /// Verification method label only (e.g. "FP", "FACE", "CARD") — never the template itself.
    pub verify_mode: Option<String>,
}

/// How a device conveys IN/OUT. Configured per device from IT/vendor documentation.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "mode", deny_unknown_fields)]
pub enum DirectionMode {
    /// The source stores a direction code; `in_codes`/`out_codes` list the exact raw values.
    Explicit {
        in_codes: Vec<String>,
        out_codes: Vec<String>,
    },
    /// The device is installed as an entry-only terminal.
    FixedIn,
    /// The device is installed as an exit-only terminal.
    FixedOut,
    /// No direction information. Events are HELD — direction is never inferred from order.
    None,
}

/// HRMS-side registration of a source device (maps to `AttendanceDevice`).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceRegistration {
    pub source_system: String,
    pub device_serial: String,
    /// `AttendanceDevice.id` in the HRMS.
    pub attendance_device_id: String,
    /// Offset of the device's local clock from UTC (Kuwait: +180). Used only when the source
    /// stores local wall-clock time without a zone.
    pub utc_offset_minutes: i32,
    pub direction_mode: DirectionMode,
    pub active: bool,
}

/// Effective-dated enrolment → employee mapping (proposed table `biometric_identity_mappings`).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IdentityMapping {
    pub source_system: String,
    /// `Some(serial)` = valid on that device only; `None` = valid on every device of the source.
    pub device_serial: Option<String>,
    pub enrollment_number: String,
    pub employee_code: String,
    pub effective_from: DateTime<Utc>,
    /// Exclusive end; `None` = open-ended.
    pub effective_to: Option<DateTime<Utc>>,
}

/// Command handed to the existing NestJS device-import contract (`POST
/// /attendance-punches/device-import`: attendanceDeviceId, sourceId, employeeCode, punchType,
/// punchTimeSource). `source_id` is the source-scoped idempotency key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommand {
    pub attendance_device_id: String,
    pub source_id: String,
    pub employee_code: String,
    pub punch_type: PunchType,
    /// Original biometric EVENT time — never the import time.
    pub punch_time_source: DateTime<Utc>,
    /// When this connector observed the event (sync time), recorded separately.
    pub synced_at: DateTime<Utc>,
    /// Informational flags (e.g. DELAYED_SYNC) for the import log / future rawPayload.
    pub flags: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HoldReason {
    UnknownDevice,
    InactiveDevice,
    UnmappedEmployee,
    AmbiguousEmployeeMapping,
    DirectionUnknown,
    DirectionCodeUnrecognised,
    EventTimeMissing,
    /// Event time is later than the time the source recorded it (+ tolerance): the device clock
    /// is ahead. Held for review instead of importing a wrong official time.
    DeviceClockAhead,
}

/// An event the connector could not import; persisted to an exception queue for HR/IT review and
/// re-processed when the cause (mapping, device registration) is fixed.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeldEvent {
    pub idempotency_key: String,
    pub reason: HoldReason,
    pub event: SourceEvent,
}

/// Incremental sync position, persisted after every fully handled batch.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub source_system: String,
    /// Highest `source_sequence` fully handled (imported, already-present, or held).
    pub last_sequence: Option<i64>,
}
