//! Punch validation — a pure, deterministic port of the post-TIME-01 NestJS rules:
//! `AttendanceValidationService.computeValidationResult` (+ `validateMobilePunch`,
//! `validateDevicePunch`, `validateManualPunch`, `pickMostSevere`) and the locked-period flag
//! added by `processNewPunch → recalculateIfAccepted → flagLockedPeriodPunch`.
//!
//! No I/O, no clock, no randomness: the same input always yields the same outcome.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::duplicate::resolve_duplicate_original;
use super::fraud::{engine_flag, has_client_fraud_signal, has_flag, preserved_flags, weight};
use super::geo::{distance_meters, js_round};
use super::input::{
    AttendanceDeviceContext, EarlierPunch, EmployeeContext, MobileDeviceContext, PunchFacts,
    ValidationInput, WorkLocationContext,
};
use super::time::{MobileIntakeRequest, kuwait_work_date, mobile_intake, to_iso_millis};
use super::types::{
    AttendanceSourceType, EmployeeStatus, MobileDeviceStatus, PunchValidationStatus,
};

/// Version of the serialized outcome shape below.
pub const RESULT_CONTRACT_VERSION: &str = "attendance-validation-result/1";
/// The NestJS rule set this engine reproduces.
pub const RULESET_VERSION: &str = "nest-post-time01-2026-11-08";
/// `MOBILE_GPS_ACCURACY_MAX_METERS`.
pub const MOBILE_GPS_ACCURACY_MAX_METERS: f64 = 100.0;

/// The fields NestJS writes to the raw punch as the validation decision.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationOutcome {
    pub validation_status: PunchValidationStatus,
    pub fraud_score: i64,
    /// Engine order: preserved (non-engine) flags first, then this run's engine flags.
    pub fraud_flags: Vec<Value>,
    pub distance_from_location_meters: Option<f64>,
    pub duplicate_of_punch_id: Option<String>,
    /// Asia/Kuwait work date of the official instant (`YYYY-MM-DD`).
    pub work_date: String,
    /// Official instant (JS `toISOString` format).
    pub punch_time_source: String,
    /// Diagnostic phone clock (mobile intake only).
    pub client_reported_time: Option<String>,
}

struct SourceResult {
    candidates: Vec<PunchValidationStatus>,
    score: i64,
    flags: Vec<Value>,
    distance: Option<f64>,
}

impl SourceResult {
    fn single(status: PunchValidationStatus, score: i64, flag: Value) -> Self {
        Self {
            candidates: vec![status],
            score,
            flags: vec![flag],
            distance: None,
        }
    }
}

struct Computation {
    status: PunchValidationStatus,
    score: i64,
    flags: Vec<Value>,
    distance: Option<f64>,
    duplicate_of: Option<String>,
}

/// Validates one punch and applies the post-validation locked-period flag.
pub fn validate(input: &ValidationInput) -> ValidationOutcome {
    let computation = compute(input);
    let work_date = kuwait_work_date(input.punch.punch_time_source).to_string();

    let mut flags = computation.flags;
    let locked = input.locked_work_dates.iter().any(|d| d == &work_date);
    if computation.status.is_accepted() && locked && !has_flag(&flags, "LOCKED_PERIOD_LATE_PUNCH") {
        flags.push(engine_flag("LOCKED_PERIOD_LATE_PUNCH", &[]));
    }

    ValidationOutcome {
        validation_status: computation.status,
        fraud_score: computation.score,
        fraud_flags: flags,
        distance_from_location_meters: computation.distance,
        // NestJS only overwrites duplicateOfPunchId when it found a duplicate; otherwise the
        // stored value (if any) remains on the row.
        duplicate_of_punch_id: computation
            .duplicate_of
            .or_else(|| input.punch.duplicate_of_punch_id.clone()),
        work_date,
        punch_time_source: to_iso_millis(input.punch.punch_time_source),
        client_reported_time: None,
    }
}

fn compute(input: &ValidationInput) -> Computation {
    let punch = &input.punch;
    let preserved = preserved_flags(&punch.fraud_flags);

    let employee = match &input.employee {
        Some(employee) if employee.status == EmployeeStatus::Active => employee,
        other => {
            let status = other.as_ref().map_or("NOT_FOUND", |e| e.status.as_str());
            let mut flags = preserved;
            flags.push(engine_flag(
                "EMPLOYEE_INACTIVE",
                &[("employeeStatus", Value::from(status))],
            ));
            return Computation {
                status: PunchValidationStatus::RejectedEmployeeInactive,
                score: weight::EMPLOYEE_INACTIVE,
                flags,
                distance: None,
                duplicate_of: None,
            };
        }
    };

    if let Some(original) = resolve_duplicate_original(input) {
        let mut flags = preserved;
        flags.push(engine_flag(
            "DUPLICATE_PUNCH",
            &[("duplicateOfPunchId", Value::from(original.clone()))],
        ));
        return Computation {
            status: PunchValidationStatus::RejectedDuplicate,
            score: weight::DUPLICATE_PUNCH,
            flags,
            distance: None,
            duplicate_of: Some(original),
        };
    }

    let source = match punch.source_type {
        AttendanceSourceType::ManualCorrection => validate_manual(punch),
        AttendanceSourceType::Mobile => validate_mobile(input, employee),
        // Every other source (biometric, face, card, web, import, future) takes the device path.
        _ => validate_device(input),
    };

    let mut flags = preserved;
    flags.extend(source.flags);
    Computation {
        status: pick_most_severe(&source.candidates),
        score: source.score,
        flags,
        distance: source.distance,
        duplicate_of: None,
    }
}

/// `pickMostSevere`: strictly-greater replaces, so ties keep the first candidate.
fn pick_most_severe(candidates: &[PunchValidationStatus]) -> PunchValidationStatus {
    let mut worst = candidates[0];
    for &candidate in &candidates[1..] {
        if candidate.severity() > worst.severity() {
            worst = candidate;
        }
    }
    worst
}

fn validate_mobile(input: &ValidationInput, employee: &EmployeeContext) -> SourceResult {
    use PunchValidationStatus as S;
    let punch = &input.punch;

    if !employee.is_mobile_punch_allowed || employee.is_device_only {
        return SourceResult::single(
            S::RejectedPolicyViolation,
            weight::MOBILE_PUNCHING_NOT_ALLOWED,
            engine_flag(
                "MOBILE_PUNCHING_NOT_ALLOWED",
                &[
                    (
                        "isMobilePunchAllowed",
                        Value::from(employee.is_mobile_punch_allowed),
                    ),
                    ("isDeviceOnly", Value::from(employee.is_device_only)),
                ],
            ),
        );
    }

    let Some(device_id) = &punch.mobile_device_id else {
        return SourceResult::single(
            S::RejectedUnregisteredDevice,
            weight::UNAPPROVED_DEVICE,
            engine_flag("DEVICE_NOT_REGISTERED", &[]),
        );
    };
    let device = match input.mobile_devices.get(device_id) {
        Some(device) if device.employee_id == employee.id => device,
        _ => {
            return SourceResult::single(
                S::RejectedUnregisteredDevice,
                weight::UNAPPROVED_DEVICE,
                engine_flag("DEVICE_BELONGS_TO_DIFFERENT_EMPLOYEE_OR_MISSING", &[]),
            );
        }
    };
    if device.status != MobileDeviceStatus::Approved {
        let flag = match device.status {
            MobileDeviceStatus::Blocked => "DEVICE_BLOCKED",
            MobileDeviceStatus::Deactivated => "DEVICE_DEACTIVATED",
            _ => "DEVICE_NOT_APPROVED",
        };
        return SourceResult::single(
            S::RejectedUnregisteredDevice,
            weight::UNAPPROVED_DEVICE,
            engine_flag(
                flag,
                &[("deviceStatus", Value::from(device.status.as_str()))],
            ),
        );
    }

    let mut candidates = Vec::new();
    let mut score = 0;
    let mut flags = Vec::new();
    let mut distance = None;

    // Work-location resolution: the punch's own, else the employee's default ("inferred").
    let (resolved_id, inferred) = match (&punch.work_location_id, &employee.work_location_id) {
        (Some(own), _) => (Some(own), false),
        (None, Some(default)) => (Some(default), true),
        (None, None) => (None, false),
    };
    let mut work_location: Option<&WorkLocationContext> = None;
    if let Some(id) = resolved_id {
        match input.work_locations.get(id) {
            Some(location) if location.is_active => {
                work_location = Some(location);
                if inferred {
                    flags.push(engine_flag(
                        "WORK_LOCATION_INFERRED_FROM_EMPLOYEE_DEFAULT",
                        &[("workLocationId", Value::from(id.clone()))],
                    ));
                }
            }
            _ => {
                flags.push(engine_flag("WORK_LOCATION_INACTIVE", &[]));
                score += weight::INACTIVE_WORK_LOCATION;
                candidates.push(S::RejectedPolicyViolation);
            }
        }
    }

    match (punch.latitude, punch.longitude) {
        (Some(lat), Some(lon)) => {
            if let Some(location) = work_location {
                let d = distance_meters(lat, lon, location.latitude, location.longitude);
                distance = Some(d);
                if d > location.geofence_radius_meters as f64 {
                    flags.push(engine_flag(
                        "OUTSIDE_GEOFENCE",
                        &[
                            ("distanceMeters", Value::from(js_round(d) as i64)),
                            (
                                "allowedRadiusMeters",
                                Value::from(location.geofence_radius_meters),
                            ),
                        ],
                    ));
                    score += weight::OUTSIDE_GEOFENCE;
                    candidates.push(S::RejectedOutsideLocation);
                }
            } else if resolved_id.is_none() {
                flags.push(engine_flag("WORK_LOCATION_NOT_ASSIGNED", &[]));
                candidates.push(S::PendingHrReview);
            }
        }
        _ => {
            flags.push(engine_flag("MISSING_LOCATION_DATA", &[]));
            score += weight::MISSING_LOCATION_DATA;
            candidates.push(S::PendingHrReview);
        }
    }

    if let Some(accuracy) = punch
        .gps_accuracy
        .filter(|a| *a > MOBILE_GPS_ACCURACY_MAX_METERS)
    {
        flags.push(engine_flag(
            "GPS_ACCURACY_POOR",
            &[("gpsAccuracy", Value::from(accuracy))],
        ));
        score += weight::POOR_GPS_ACCURACY;
        candidates.push(S::PendingHrReview);
    }

    if has_client_fraud_signal(&punch.fraud_flags) {
        flags.push(engine_flag("FAKE_GPS_SIGNAL", &[]));
        score += weight::FAKE_GPS_SIGNAL;
        candidates.push(S::RejectedFakeGps);
    }

    if candidates.is_empty() {
        candidates.push(S::Accepted);
    }
    SourceResult {
        candidates,
        score,
        flags,
        distance,
    }
}

fn validate_device(input: &ValidationInput) -> SourceResult {
    use PunchValidationStatus as S;
    let Some(device_id) = &input.punch.attendance_device_id else {
        return SourceResult::single(
            S::PendingHrReview,
            0,
            engine_flag("UNRECOGNIZED_SOURCE_NO_DEVICE", &[]),
        );
    };
    let device = match input.attendance_devices.get(device_id) {
        Some(device) if device.is_active => device,
        _ => {
            return SourceResult::single(
                S::RejectedUnregisteredDevice,
                weight::UNAPPROVED_DEVICE,
                engine_flag("ATTENDANCE_DEVICE_INACTIVE_OR_MISSING", &[]),
            );
        }
    };
    // Physical devices sit at a vetted location: no GPS/geofence check (existing rule C).
    match input.work_locations.get(&device.work_location_id) {
        Some(location) if location.is_active => SourceResult {
            candidates: vec![S::Accepted],
            score: 0,
            flags: Vec::new(),
            distance: None,
        },
        _ => SourceResult::single(
            S::RejectedPolicyViolation,
            weight::INACTIVE_WORK_LOCATION,
            engine_flag("WORK_LOCATION_INACTIVE", &[]),
        ),
    }
}

fn validate_manual(punch: &PunchFacts) -> SourceResult {
    use PunchValidationStatus as S;
    let reason = punch.raw_payload.get("reason").and_then(Value::as_str);
    if reason.is_some_and(|r| !r.trim().is_empty()) {
        // Never auto-accepted: manual punches become official only via correction approval.
        SourceResult {
            candidates: vec![S::PendingManagerApproval],
            score: 0,
            flags: Vec::new(),
            distance: None,
        }
    } else {
        SourceResult::single(
            S::RejectedPolicyViolation,
            weight::MISSING_MANUAL_REASON,
            engine_flag("MISSING_REASON", &[]),
        )
    }
}

/// Full TIME-01 mobile intake followed by validation: mirrors `createMobile` → `processNewPunch`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MobileIntakeInput {
    pub punch_id: String,
    /// Trusted server receipt instant — the only source of the official time.
    pub server_received_at: DateTime<Utc>,
    pub request: MobileIntakeRequest,
    pub employee: Option<EmployeeContext>,
    #[serde(default)]
    pub work_locations: BTreeMap<String, WorkLocationContext>,
    #[serde(default)]
    pub mobile_devices: BTreeMap<String, MobileDeviceContext>,
    #[serde(default)]
    pub attendance_devices: BTreeMap<String, AttendanceDeviceContext>,
    #[serde(default)]
    pub earlier_punches: Vec<EarlierPunch>,
    #[serde(default)]
    pub locked_work_dates: Vec<String>,
}

pub fn validate_mobile_intake(input: &MobileIntakeInput) -> ValidationOutcome {
    let intake = mobile_intake(input.server_received_at, &input.request);
    // `createMobile` resolves the device by identifier regardless of owner; ownership/approval
    // is the validator's job.
    let mobile_device_id = input
        .mobile_devices
        .iter()
        .find(|(_, d)| {
            d.device_identifier.as_deref() == Some(input.request.device_identifier.as_str())
        })
        .map(|(id, _)| id.clone());

    let validation_input = ValidationInput {
        punch: PunchFacts {
            id: input.punch_id.clone(),
            punch_type: input.request.punch_type,
            source_type: AttendanceSourceType::Mobile,
            punch_time_source: intake.punch_time_source,
            source_id: None,
            latitude: input.request.latitude,
            longitude: input.request.longitude,
            gps_accuracy: input.request.gps_accuracy,
            work_location_id: input.request.work_location_id.clone(),
            mobile_device_id,
            attendance_device_id: None,
            duplicate_of_punch_id: None,
            fraud_flags: intake.intake_flags,
            raw_payload: Value::Null,
        },
        employee: input.employee.clone(),
        work_locations: input.work_locations.clone(),
        mobile_devices: input.mobile_devices.clone(),
        attendance_devices: input.attendance_devices.clone(),
        earlier_punches: input.earlier_punches.clone(),
        other_existing_punch_ids: Vec::new(),
        locked_work_dates: input.locked_work_dates.clone(),
    };

    let mut outcome = validate(&validation_input);
    outcome.client_reported_time = intake.client_reported_time.map(to_iso_millis);
    outcome
}
