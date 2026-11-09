//! Validation input: every fact the NestJS `computeValidationResult` reads from the database,
//! supplied explicitly so the Rust engine performs no I/O and reads no clock.
//!
//! This is also the JSON fixture format (`packages/attendance-test-vectors`), camelCase.
//! Identifiers are opaque strings (fixture refs or database ids).

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;

use super::types::{AttendanceSourceType, EmployeeStatus, MobileDeviceStatus, PunchType};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValidationInput {
    /// The raw punch being validated, as stored at intake.
    pub punch: PunchFacts,
    /// `None` = no employee row (NestJS: `employee?.status ?? 'NOT_FOUND'`).
    pub employee: Option<EmployeeContext>,
    #[serde(default)]
    pub work_locations: BTreeMap<String, WorkLocationContext>,
    #[serde(default)]
    pub mobile_devices: BTreeMap<String, MobileDeviceContext>,
    #[serde(default)]
    pub attendance_devices: BTreeMap<String, AttendanceDeviceContext>,
    /// Other punches of the same employee ordered strictly BEFORE this one by `(createdAt, id)`.
    #[serde(default)]
    pub earlier_punches: Vec<EarlierPunch>,
    /// Ids of further existing punches (any employee/order) — only consulted for an explicit
    /// `punch.duplicateOfPunchId` link, which NestJS resolves with a plain `findUnique`.
    #[serde(default)]
    pub other_existing_punch_ids: Vec<String>,
    /// Asia/Kuwait work dates (`YYYY-MM-DD`) inside a LOCKED payroll period.
    #[serde(default)]
    pub locked_work_dates: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PunchFacts {
    pub id: String,
    pub punch_type: PunchType,
    pub source_type: AttendanceSourceType,
    /// The OFFICIAL instant: server receipt time for mobile (TIME-01), device event time for
    /// device imports, requested time for manual punches. Never a client clock for mobile.
    pub punch_time_source: DateTime<Utc>,
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default)]
    pub latitude: Option<f64>,
    #[serde(default)]
    pub longitude: Option<f64>,
    #[serde(default)]
    pub gps_accuracy: Option<f64>,
    #[serde(default)]
    pub work_location_id: Option<String>,
    #[serde(default)]
    pub mobile_device_id: Option<String>,
    #[serde(default)]
    pub attendance_device_id: Option<String>,
    #[serde(default)]
    pub duplicate_of_punch_id: Option<String>,
    /// Flags already on the row (intake flags such as CLIENT_REPORTED_SIGNALS / INTAKE flags).
    #[serde(default)]
    pub fraud_flags: Vec<Value>,
    #[serde(default)]
    pub raw_payload: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EmployeeContext {
    pub id: String,
    pub status: EmployeeStatus,
    pub is_mobile_punch_allowed: bool,
    pub is_device_only: bool,
    #[serde(default)]
    pub work_location_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkLocationContext {
    pub latitude: f64,
    pub longitude: f64,
    pub geofence_radius_meters: i64,
    pub is_active: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MobileDeviceContext {
    /// Owner employee id.
    pub employee_id: String,
    pub status: MobileDeviceStatus,
    /// Used only by mobile intake to resolve `deviceIdentifier` → device id.
    #[serde(default)]
    pub device_identifier: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttendanceDeviceContext {
    pub is_active: bool,
    pub work_location_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EarlierPunch {
    pub id: String,
    pub punch_type: PunchType,
    pub source_type: AttendanceSourceType,
    pub punch_time_source: DateTime<Utc>,
    #[serde(default)]
    pub source_id: Option<String>,
    /// Informational only: NestJS's duplicate rule ignores the earlier punch's status.
    #[serde(default)]
    pub validation_status: Option<String>,
}
