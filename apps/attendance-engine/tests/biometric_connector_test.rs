//! RUST-04 SYNTHETIC connector tests. No real biometric source, credentials, templates or
//! employee data are used: every record below is invented. These tests verify the connector's
//! logic only — they say NOTHING about the real RECAFCO source schema, which is not yet available.

use std::collections::BTreeMap;

use chrono::{DateTime, NaiveDateTime, Utc};
use recafco_attendance_engine::biometric::connector::{
    ConnectorConfig, ImportResult, ImportSink, SinkError, SourceError, SourceReader, SyncError,
    classify_event, sync_once,
};
use recafco_attendance_engine::biometric::identity::{IdentityResolution, resolve_employee};
use recafco_attendance_engine::biometric::model::{
    Checkpoint, DeviceRegistration, DirectionMode, HeldEvent, HoldReason, IdentityMapping,
    ImportCommand, SourceEvent,
};
use recafco_attendance_engine::domain::punch_pairing::SummaryPunch;
use recafco_attendance_engine::domain::summary::{SummaryInput, calculate_daily_summary};
use recafco_attendance_engine::domain::types::{
    AttendanceSourceType, DailyAttendanceStatus, PunchType, PunchValidationStatus,
};
use recafco_attendance_engine::domain::{ValidationInput, validate};
use serde_json::json;

const SRC: &str = "synthetic-biometric-db";

fn utc(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
}
fn local(s: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap()
}

fn explicit() -> DirectionMode {
    DirectionMode::Explicit {
        in_codes: vec!["0".into(), "I".into()],
        out_codes: vec!["1".into(), "O".into()],
    }
}

fn devices() -> Vec<DeviceRegistration> {
    let device = |serial: &str, id: &str, mode: DirectionMode, active: bool| DeviceRegistration {
        source_system: SRC.into(),
        device_serial: serial.into(),
        attendance_device_id: id.into(),
        utc_offset_minutes: 180, // Asia/Kuwait
        direction_mode: mode,
        active,
    };
    vec![
        device("DEV-A-001", "hrms-dev-a", explicit(), true),
        device("DEV-B-002", "hrms-dev-b", explicit(), true),
        device(
            "GATE-EXIT-01",
            "hrms-gate-exit",
            DirectionMode::FixedOut,
            true,
        ),
        device("OLD-NODIR-03", "hrms-old", DirectionMode::None, true),
        device("RETIRED-09", "hrms-retired", explicit(), false),
    ]
}

fn mappings() -> Vec<IdentityMapping> {
    let map = |device: Option<&str>, enrol: &str, code: &str, from: &str, to: Option<&str>| {
        IdentityMapping {
            source_system: SRC.into(),
            device_serial: device.map(str::to_owned),
            enrollment_number: enrol.into(),
            employee_code: code.into(),
            effective_from: utc(from),
            effective_to: to.map(utc),
        }
    };
    vec![
        map(None, "1001", "EMP-1001", "2026-01-01T00:00:00Z", None),
        // Same enrolment number "7" on two machines = two different people (device-scoped).
        map(
            Some("DEV-A-001"),
            "7",
            "EMP-0007A",
            "2026-01-01T00:00:00Z",
            None,
        ),
        map(
            Some("DEV-B-002"),
            "7",
            "EMP-0007B",
            "2026-01-01T00:00:00Z",
            None,
        ),
        // Enrolment number reused after a transfer: effective-dated history.
        map(
            None,
            "2002",
            "EMP-2002",
            "2026-01-01T00:00:00Z",
            Some("2026-11-05T00:00:00Z"),
        ),
        map(None, "2002", "EMP-2099", "2026-11-05T00:00:00Z", None),
        // Data error: two source-wide mappings for the same number → ambiguous, never guessed.
        map(None, "3003", "EMP-3003", "2026-01-01T00:00:00Z", None),
        map(None, "3003", "EMP-3333", "2026-01-01T00:00:00Z", None),
    ]
}

#[allow(clippy::too_many_arguments)]
fn ev(
    seq: i64,
    device: &str,
    enrol: &str,
    at_local: &str,
    dir: Option<&str>,
    log: Option<&str>,
    recorded_local: Option<&str>,
) -> SourceEvent {
    SourceEvent {
        source_system: SRC.into(),
        source_sequence: Some(seq),
        source_row_id: Some(format!("row-{seq}")),
        device_serial: Some(device.into()),
        device_local_event_id: log.map(str::to_owned),
        enrollment_number: enrol.into(),
        event_time_local: Some(local(at_local)),
        event_time_utc: None,
        direction_raw: dir.map(str::to_owned),
        source_recorded_at: recorded_local.map(|r| local(r).and_utc() - chrono::Duration::hours(3)),
        verify_mode: Some("FP".into()),
    }
}

/// Read-only in-memory stand-in for the biometric source.
#[derive(Default)]
struct FakeSource {
    rows: Vec<SourceEvent>,
    fail_on_call: Option<usize>,
    calls: usize,
    rows_returned: usize,
}
impl SourceReader for FakeSource {
    fn read_after(
        &mut self,
        after: Option<i64>,
        limit: usize,
    ) -> Result<Vec<SourceEvent>, SourceError> {
        self.calls += 1;
        if self.fail_on_call == Some(self.calls) {
            return Err(SourceError::Unavailable(
                "connection refused (synthetic outage)".into(),
            ));
        }
        let mut rows: Vec<SourceEvent> = self
            .rows
            .iter()
            .filter(|r| after.is_none_or(|a| r.source_sequence.unwrap_or(i64::MIN) > a))
            .cloned()
            .collect();
        rows.sort_by_key(|r| r.source_sequence);
        rows.truncate(limit);
        self.rows_returned += rows.len();
        Ok(rows)
    }
}

/// Mimics the existing NestJS device-import idempotency (unique attendanceDeviceId + sourceId)
/// and an exception queue keyed by idempotency key.
#[derive(Default)]
struct FakeHrms {
    imported: BTreeMap<(String, String), ImportCommand>,
    held: BTreeMap<String, HeldEvent>,
    fail_after_imports: Option<usize>,
}
impl ImportSink for FakeHrms {
    fn import(&mut self, command: &ImportCommand) -> Result<ImportResult, SinkError> {
        if self
            .fail_after_imports
            .is_some_and(|n| self.imported.len() >= n)
        {
            return Err(SinkError::Unavailable("HRMS API 503 (synthetic)".into()));
        }
        let key = (
            command.attendance_device_id.clone(),
            command.source_id.clone(),
        );
        if self.imported.contains_key(&key) {
            return Ok(ImportResult::AlreadyExists);
        }
        self.imported.insert(key, command.clone());
        Ok(ImportResult::Created)
    }
    fn hold(&mut self, held: &HeldEvent) -> Result<(), SinkError> {
        self.held.insert(held.idempotency_key.clone(), held.clone());
        Ok(())
    }
}

fn run(
    source: &mut FakeSource,
    hrms: &mut FakeHrms,
    cp: &Checkpoint,
    synced_at: &str,
) -> Result<recafco_attendance_engine::biometric::connector::SyncReport, SyncError> {
    let config = ConnectorConfig {
        batch_size: 20,
        overlap_sequences: 5,
        max_batches_per_run: 50,
    };
    sync_once(
        source,
        hrms,
        &devices(),
        &mappings(),
        cp,
        config,
        utc(synced_at),
    )
}

fn cp() -> Checkpoint {
    Checkpoint {
        source_system: SRC.into(),
        last_sequence: None,
    }
}

fn only_import(hrms: &FakeHrms) -> &ImportCommand {
    assert_eq!(hrms.imported.len(), 1);
    hrms.imported.values().next().unwrap()
}

fn summary_punch(
    id: &str,
    t: PunchType,
    source: AttendanceSourceType,
    at: DateTime<Utc>,
) -> SummaryPunch {
    SummaryPunch {
        id: id.into(),
        punch_type: t,
        source_type: source,
        validation_status: PunchValidationStatus::Accepted,
        punch_time_source: at,
        is_official: false,
    }
}

fn summary(
    date: &str,
    punches: Vec<SummaryPunch>,
) -> recafco_attendance_engine::domain::SummaryOutcome {
    calculate_daily_summary(&SummaryInput {
        employee_id: "EMP-1001".into(),
        work_date: date.parse().unwrap(),
        punches,
        shift_assignments: vec![],
        existing_summary: None,
        period_locked: false,
    })
}

// ------------------------------------------------------------------------------------------
// The 15 required scenarios
// ------------------------------------------------------------------------------------------

#[test]
fn s01_normal_biometric_in_preserves_event_time_and_records_sync_time_separately() {
    let mut source = FakeSource {
        rows: vec![ev(
            1,
            "DEV-A-001",
            "1001",
            "2026-11-08 07:00:00",
            Some("0"),
            Some("501"),
            Some("2026-11-08 07:00:02"),
        )],
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    let report = run(&mut source, &mut hrms, &cp(), "2026-11-08T04:05:00Z").unwrap();
    let cmd = only_import(&hrms);
    assert_eq!(cmd.punch_type, PunchType::In);
    assert_eq!(cmd.employee_code, "EMP-1001");
    assert_eq!(cmd.attendance_device_id, "hrms-dev-a");
    assert_eq!(
        cmd.punch_time_source,
        utc("2026-11-08T04:00:00Z"),
        "07:00 Kuwait device time → 04:00Z"
    );
    assert_eq!(cmd.synced_at, utc("2026-11-08T04:05:00Z"));
    assert_eq!(
        cmd.source_id,
        "bio:synthetic-biometric-db:dev:DEV-A-001:log:501:1794110400000"
    );
    assert!(cmd.flags.is_empty());
    assert_eq!(report.checkpoint.last_sequence, Some(1));
}

#[test]
fn s02_normal_biometric_out() {
    let mut source = FakeSource {
        rows: vec![ev(
            1,
            "DEV-A-001",
            "1001",
            "2026-11-08 16:00:00",
            Some("1"),
            Some("502"),
            None,
        )],
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    run(&mut source, &mut hrms, &cp(), "2026-11-08T13:01:00Z").unwrap();
    assert_eq!(only_import(&hrms).punch_type, PunchType::Out);
}

#[test]
fn s03_mobile_in_plus_biometric_out_builds_one_summary_with_both_sources() {
    let mut source = FakeSource {
        rows: vec![ev(
            1,
            "GATE-EXIT-01",
            "1001",
            "2026-11-08 16:05:00",
            None,
            Some("9"),
            None,
        )],
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    run(&mut source, &mut hrms, &cp(), "2026-11-08T13:10:00Z").unwrap();
    let out = only_import(&hrms);
    let result = summary(
        "2026-11-08",
        vec![
            summary_punch(
                "mobile-in",
                PunchType::In,
                AttendanceSourceType::Mobile,
                utc("2026-11-08T03:58:00Z"),
            ),
            summary_punch(
                &out.source_id,
                out.punch_type,
                AttendanceSourceType::BiometricDevice,
                out.punch_time_source,
            ),
        ],
    );
    assert_eq!(result.status, Some(DailyAttendanceStatus::Present));
    assert_eq!(
        result.official_in_source_type,
        Some(AttendanceSourceType::Mobile)
    );
    assert_eq!(
        result.official_out_source_type,
        Some(AttendanceSourceType::BiometricDevice)
    );
    assert_eq!(result.total_worked_minutes, Some(547));
}

#[test]
fn s04_biometric_in_plus_mobile_out() {
    let mut source = FakeSource {
        rows: vec![ev(
            1,
            "DEV-B-002",
            "1001",
            "2026-11-08 06:55:00",
            Some("I"),
            Some("77"),
            None,
        )],
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    run(&mut source, &mut hrms, &cp(), "2026-11-08T04:00:00Z").unwrap();
    let inn = only_import(&hrms);
    let result = summary(
        "2026-11-08",
        vec![
            summary_punch(
                &inn.source_id,
                inn.punch_type,
                AttendanceSourceType::BiometricDevice,
                inn.punch_time_source,
            ),
            summary_punch(
                "mobile-out",
                PunchType::Out,
                AttendanceSourceType::Mobile,
                utc("2026-11-08T13:02:00Z"),
            ),
        ],
    );
    assert_eq!(
        result.official_in_source_type,
        Some(AttendanceSourceType::BiometricDevice)
    );
    assert_eq!(
        result.official_out_source_type,
        Some(AttendanceSourceType::Mobile)
    );
    assert_eq!(result.status, Some(DailyAttendanceStatus::Present));
}

#[test]
fn s05_duplicate_import_of_the_same_event_is_absorbed() {
    let row = ev(
        1,
        "DEV-A-001",
        "1001",
        "2026-11-08 07:00:00",
        Some("0"),
        Some("501"),
        None,
    );
    let mut source = FakeSource {
        rows: vec![row.clone()],
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    let first = run(&mut source, &mut hrms, &cp(), "2026-11-08T04:05:00Z").unwrap();
    // Re-run from the start (e.g. lost checkpoint) and a second copy of the same source row.
    source.rows.push(SourceEvent {
        source_sequence: Some(2),
        source_row_id: Some("row-2".into()),
        ..row
    });
    let second = run(&mut source, &mut hrms, &cp(), "2026-11-08T04:10:00Z").unwrap();
    assert_eq!(first.imported, 1);
    assert_eq!(
        second.imported, 0,
        "no new punch from a re-read or a duplicated source row"
    );
    assert_eq!(second.already_present, 2);
    assert_eq!(hrms.imported.len(), 1);
}

#[test]
fn s06_same_device_log_number_on_two_devices_does_not_collide() {
    let mut source = FakeSource {
        rows: vec![
            ev(
                1,
                "DEV-A-001",
                "1001",
                "2026-11-08 07:00:00",
                Some("0"),
                Some("5001"),
                None,
            ),
            ev(
                2,
                "DEV-B-002",
                "1001",
                "2026-11-08 11:00:00",
                Some("0"),
                Some("5001"),
                None,
            ),
        ],
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    let report = run(&mut source, &mut hrms, &cp(), "2026-11-08T08:05:00Z").unwrap();
    assert_eq!(report.imported, 2);
    let keys: Vec<&String> = hrms.imported.values().map(|c| &c.source_id).collect();
    assert_ne!(keys[0], keys[1]);

    // Why scoping matters, proven with the RUST-02 validation engine (current NestJS rules, V44):
    // the second punch is wrongly a duplicate if the RAW log number is used as sourceId, and
    // correctly accepted with the device-scoped key.
    let second_with = |earlier_source_id: &str, own_source_id: &str| {
        let input: ValidationInput = serde_json::from_value(json!({
            "punch": {"id": "p2", "punchType": "IN", "sourceType": "BIOMETRIC_DEVICE",
                      "punchTimeSource": "2026-11-08T08:00:00.000Z", "attendanceDeviceId": "hrms-dev-b",
                      "sourceId": own_source_id},
            "employee": {"id": "e", "status": "ACTIVE", "isMobilePunchAllowed": true, "isDeviceOnly": false},
            "workLocations": {"loc": {"latitude": 29.0, "longitude": 47.0, "geofenceRadiusMeters": 100, "isActive": true}},
            "attendanceDevices": {"hrms-dev-b": {"isActive": true, "workLocationId": "loc"}},
            "earlierPunches": [{"id": "p1", "punchType": "IN", "sourceType": "BIOMETRIC_DEVICE",
                                "punchTimeSource": "2026-11-08T04:00:00.000Z", "sourceId": earlier_source_id}]
        }))
        .unwrap();
        serde_json::to_value(validate(&input).validation_status).unwrap()
    };
    assert_eq!(
        second_with("5001", "5001"),
        "REJECTED_DUPLICATE",
        "raw log numbers collide (V44)"
    );
    assert_eq!(
        second_with(keys[0], keys[1]),
        "ACCEPTED",
        "device-scoped keys do not"
    );
}

#[test]
fn s07_unknown_employee_is_held_then_imported_after_mapping_is_added() {
    let row = ev(
        1,
        "DEV-A-001",
        "9999",
        "2026-11-08 07:00:00",
        Some("0"),
        Some("601"),
        None,
    );
    let mut source = FakeSource {
        rows: vec![row.clone()],
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    let report = run(&mut source, &mut hrms, &cp(), "2026-11-08T04:05:00Z").unwrap();
    assert_eq!(report.held, 1);
    assert_eq!(
        report.checkpoint.last_sequence,
        Some(1),
        "held events are recorded, so the checkpoint advances"
    );
    let held = hrms.held.values().next().unwrap();
    assert_eq!(held.reason, HoldReason::UnmappedEmployee);

    // HR/IT adds the mapping (audited, effective-dated); the held event is re-processed.
    let mut fixed = mappings();
    fixed.push(IdentityMapping {
        source_system: SRC.into(),
        device_serial: None,
        enrollment_number: "9999".into(),
        employee_code: "EMP-9999".into(),
        effective_from: utc("2026-01-01T00:00:00Z"),
        effective_to: None,
    });
    let cmd = classify_event(&held.event, &devices(), &fixed, utc("2026-11-08T05:00:00Z")).unwrap();
    assert_eq!(cmd.employee_code, "EMP-9999");
    assert_eq!(
        cmd.source_id, held.idempotency_key,
        "same key → still idempotent"
    );
}

#[test]
fn s08_unknown_device_is_held() {
    let mut source = FakeSource {
        rows: vec![ev(
            1,
            "UNREGISTERED-77",
            "1001",
            "2026-11-08 07:00:00",
            Some("0"),
            Some("1"),
            None,
        )],
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    run(&mut source, &mut hrms, &cp(), "2026-11-08T04:05:00Z").unwrap();
    assert!(hrms.imported.is_empty());
    assert_eq!(
        hrms.held.values().next().unwrap().reason,
        HoldReason::UnknownDevice
    );
}

#[test]
fn s09_delayed_sync_keeps_event_time_and_flags_the_delay() {
    let mut source = FakeSource {
        rows: vec![ev(
            1,
            "DEV-A-001",
            "1001",
            "2026-11-08 07:00:00",
            Some("0"),
            Some("701"),
            Some("2026-11-08 13:00:00"),
        )],
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    run(&mut source, &mut hrms, &cp(), "2026-11-08T10:00:30Z").unwrap();
    let cmd = only_import(&hrms);
    assert_eq!(
        cmd.punch_time_source,
        utc("2026-11-08T04:00:00Z"),
        "event time, not the 13:00 sync"
    );
    assert_eq!(cmd.synced_at, utc("2026-11-08T10:00:30Z"));
    assert_eq!(cmd.flags, vec!["DELAYED_SYNC".to_owned()]);
}

#[test]
fn s10_device_clock_ahead_is_held_but_small_drift_is_tolerated() {
    let mut source = FakeSource {
        rows: vec![
            // Device says 09:30 but the source recorded the row at 07:00 → clock ~2.5 h ahead.
            ev(
                1,
                "DEV-A-001",
                "1001",
                "2026-11-08 09:30:00",
                Some("0"),
                Some("801"),
                Some("2026-11-08 07:00:00"),
            ),
            // 3 minutes ahead: inside the 5-minute tolerance.
            ev(
                2,
                "DEV-B-002",
                "2002",
                "2026-11-08 07:03:00",
                Some("0"),
                Some("802"),
                Some("2026-11-08 07:00:00"),
            ),
        ],
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    let report = run(&mut source, &mut hrms, &cp(), "2026-11-08T04:01:00Z").unwrap();
    assert_eq!((report.imported, report.held), (1, 1));
    assert_eq!(
        hrms.held.values().next().unwrap().reason,
        HoldReason::DeviceClockAhead
    );
}

#[test]
fn s11_offline_device_resync_imports_backlog_with_original_times_across_batches() {
    let rows: Vec<SourceEvent> = (0..50)
        .map(|i| {
            let day = 5 + i / 16;
            let minute = i % 16;
            ev(
                i as i64 + 1,
                "DEV-A-001",
                "1001",
                &format!("2026-11-{day:02} 07:{minute:02}:00"),
                Some(if i % 2 == 0 { "0" } else { "1" }),
                Some(&format!("{}", 9000 + i)),
                Some("2026-11-08 12:00:00"),
            )
        })
        .collect();
    let mut source = FakeSource {
        rows,
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    let report = run(&mut source, &mut hrms, &cp(), "2026-11-08T09:00:00Z").unwrap();
    assert_eq!(report.imported, 50);
    assert!(source.calls >= 3, "batch size 20 → several bounded reads");
    assert!(
        hrms.imported
            .values()
            .all(|c| c.flags == vec!["DELAYED_SYNC".to_owned()])
    );
    assert!(
        hrms.imported
            .values()
            .any(|c| c.punch_time_source == utc("2026-11-05T04:00:00Z"))
    );
}

#[test]
fn s12_out_of_order_events_give_the_same_summary_in_any_order() {
    let rows = vec![
        ev(
            1,
            "DEV-A-001",
            "1001",
            "2026-11-08 16:10:00",
            Some("1"),
            Some("12"),
            None,
        ),
        ev(
            2,
            "DEV-A-001",
            "1001",
            "2026-11-08 07:05:00",
            Some("0"),
            Some("10"),
            None,
        ),
        ev(
            3,
            "DEV-A-001",
            "1001",
            "2026-11-08 06:59:00",
            Some("0"),
            Some("9"),
            None,
        ),
        ev(
            4,
            "DEV-A-001",
            "1001",
            "2026-11-08 15:50:00",
            Some("1"),
            Some("11"),
            None,
        ),
    ];
    let mut source = FakeSource {
        rows,
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    run(&mut source, &mut hrms, &cp(), "2026-11-08T14:00:00Z").unwrap();
    let mut punches: Vec<SummaryPunch> = hrms
        .imported
        .values()
        .map(|c| {
            summary_punch(
                &c.source_id,
                c.punch_type,
                AttendanceSourceType::BiometricDevice,
                c.punch_time_source,
            )
        })
        .collect();
    let forward = summary("2026-11-08", punches.clone());
    punches.reverse();
    let backward = summary("2026-11-08", punches);
    assert_eq!(forward, backward);
    assert_eq!(
        forward.official_in_time.as_deref(),
        Some("2026-11-08T03:59:00.000Z")
    );
    assert_eq!(
        forward.official_out_time.as_deref(),
        Some("2026-11-08T13:10:00.000Z")
    );
}

#[test]
fn s13_overnight_attendance_imports_correct_instants_but_current_summary_splits_days() {
    let mut source = FakeSource {
        rows: vec![
            ev(
                1,
                "DEV-A-001",
                "1001",
                "2026-11-08 22:00:00",
                Some("0"),
                Some("31"),
                None,
            ),
            ev(
                2,
                "DEV-A-001",
                "1001",
                "2026-11-09 06:00:00",
                Some("1"),
                Some("32"),
                None,
            ),
        ],
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    run(&mut source, &mut hrms, &cp(), "2026-11-09T03:05:00Z").unwrap();
    let punches: Vec<SummaryPunch> = hrms
        .imported
        .values()
        .map(|c| {
            summary_punch(
                &c.source_id,
                c.punch_type,
                AttendanceSourceType::BiometricDevice,
                c.punch_time_source,
            )
        })
        .collect();
    assert!(
        punches
            .iter()
            .any(|p| p.punch_time_source == utc("2026-11-08T19:00:00Z"))
    );
    assert!(
        punches
            .iter()
            .any(|p| p.punch_time_source == utc("2026-11-09T03:00:00Z"))
    );
    // Existing behaviour D4 (shift-payroll-rules.md): calendar-day grouping splits the shift.
    assert_eq!(
        summary("2026-11-08", punches.clone()).status,
        Some(DailyAttendanceStatus::MissingPunch)
    );
    assert_eq!(
        summary("2026-11-09", punches).status,
        Some(DailyAttendanceStatus::MissingPunch)
    );
}

#[test]
fn s14_missing_or_unknown_direction_is_held_never_inferred() {
    let mut source = FakeSource {
        rows: vec![
            ev(
                1,
                "OLD-NODIR-03",
                "1001",
                "2026-11-08 07:00:00",
                None,
                Some("41"),
                None,
            ),
            ev(
                2,
                "OLD-NODIR-03",
                "1001",
                "2026-11-08 16:00:00",
                None,
                Some("42"),
                None,
            ),
            ev(
                3,
                "DEV-A-001",
                "1001",
                "2026-11-08 07:01:00",
                None,
                Some("43"),
                None,
            ),
            ev(
                4,
                "DEV-A-001",
                "1001",
                "2026-11-08 12:00:00",
                Some("4"),
                Some("44"),
                None,
            ), // e.g. an OT/break code
        ],
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    let report = run(&mut source, &mut hrms, &cp(), "2026-11-08T13:05:00Z").unwrap();
    assert_eq!(
        (report.imported, report.held),
        (0, 4),
        "an IN-then-OUT pair is NOT inferred from order"
    );
    let reasons: Vec<HoldReason> = hrms.held.values().map(|h| h.reason).collect();
    assert_eq!(
        reasons
            .iter()
            .filter(|r| **r == HoldReason::DirectionUnknown)
            .count(),
        3
    );
    assert_eq!(
        reasons
            .iter()
            .filter(|r| **r == HoldReason::DirectionCodeUnrecognised)
            .count(),
        1
    );
}

#[test]
fn s15_source_unavailable_stops_safely_and_retry_imports_everything_exactly_once() {
    let rows: Vec<SourceEvent> = (1..=45)
        .map(|i| {
            ev(
                i,
                "DEV-A-001",
                "1001",
                &format!("2026-11-08 07:{:02}:00", i % 60),
                Some("0"),
                Some(&format!("{}", 100 + i)),
                None,
            )
        })
        .collect();
    let mut source = FakeSource {
        rows,
        fail_on_call: Some(2),
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    let error = run(&mut source, &mut hrms, &cp(), "2026-11-08T05:00:00Z").unwrap_err();
    let SyncError::Source { report, .. } = error else {
        panic!("expected a source error")
    };
    assert_eq!(
        report.checkpoint.last_sequence,
        Some(20),
        "checkpoint = last fully handled event"
    );
    assert_eq!(hrms.imported.len(), 20);

    source.fail_on_call = None;
    let retry = run(
        &mut source,
        &mut hrms,
        &report.checkpoint,
        "2026-11-08T05:10:00Z",
    )
    .unwrap();
    assert_eq!(hrms.imported.len(), 45, "every event imported exactly once");
    assert_eq!(retry.checkpoint.last_sequence, Some(45));
    assert!(
        retry.already_present <= 5,
        "only the overlap window is re-read"
    );
}

// ------------------------------------------------------------------------------------------
// Additional safety properties
// ------------------------------------------------------------------------------------------

#[test]
fn identity_mapping_is_device_scoped_effective_dated_and_never_guessed() {
    let m = mappings();
    let at = utc("2026-11-08T04:00:00Z");
    let resolved = |device: &str, enrol: &str, when: DateTime<Utc>| {
        resolve_employee(&m, SRC, Some(device), enrol, when)
    };
    assert_eq!(
        resolved("DEV-A-001", "7", at),
        IdentityResolution::Resolved {
            employee_code: "EMP-0007A".into()
        }
    );
    assert_eq!(
        resolved("DEV-B-002", "7", at),
        IdentityResolution::Resolved {
            employee_code: "EMP-0007B".into()
        }
    );
    assert_eq!(
        resolved("GATE-EXIT-01", "7", at),
        IdentityResolution::Unmapped,
        "no source-wide fallback exists for 7"
    );
    assert_eq!(
        resolved("DEV-A-001", "2002", utc("2026-11-04T10:00:00Z")),
        IdentityResolution::Resolved {
            employee_code: "EMP-2002".into()
        }
    );
    assert_eq!(
        resolved("DEV-A-001", "2002", utc("2026-11-05T00:00:00Z")),
        IdentityResolution::Resolved {
            employee_code: "EMP-2099".into()
        },
        "transfer boundary"
    );
    assert!(matches!(
        resolved("DEV-A-001", "3003", at),
        IdentityResolution::Ambiguous { .. }
    ));
}

#[test]
fn ambiguous_mapping_and_inactive_device_are_held() {
    let mut source = FakeSource {
        rows: vec![
            ev(
                1,
                "DEV-A-001",
                "3003",
                "2026-11-08 07:00:00",
                Some("0"),
                Some("1"),
                None,
            ),
            ev(
                2,
                "RETIRED-09",
                "1001",
                "2026-11-08 07:00:00",
                Some("0"),
                Some("2"),
                None,
            ),
        ],
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    run(&mut source, &mut hrms, &cp(), "2026-11-08T04:05:00Z").unwrap();
    let mut reasons: Vec<HoldReason> = hrms.held.values().map(|h| h.reason).collect();
    reasons.sort_by_key(|r| format!("{r:?}"));
    assert_eq!(
        reasons,
        vec![
            HoldReason::AmbiguousEmployeeMapping,
            HoldReason::InactiveDevice
        ]
    );
}

#[test]
fn sink_failure_keeps_checkpoint_at_last_handled_event() {
    let rows: Vec<SourceEvent> = (1..=10)
        .map(|i| {
            ev(
                i,
                "DEV-A-001",
                "1001",
                &format!("2026-11-08 07:{i:02}:00"),
                Some("0"),
                Some(&format!("{i}")),
                None,
            )
        })
        .collect();
    let mut source = FakeSource {
        rows,
        ..Default::default()
    };
    let mut hrms = FakeHrms {
        fail_after_imports: Some(4),
        ..Default::default()
    };
    let error = run(&mut source, &mut hrms, &cp(), "2026-11-08T05:00:00Z").unwrap_err();
    let SyncError::Sink { report, .. } = error else {
        panic!("expected a sink error")
    };
    assert_eq!(report.checkpoint.last_sequence, Some(4));
    hrms.fail_after_imports = None;
    run(
        &mut source,
        &mut hrms,
        &report.checkpoint,
        "2026-11-08T05:01:00Z",
    )
    .unwrap();
    assert_eq!(hrms.imported.len(), 10);
}

#[test]
fn checkpoint_survives_restart_and_next_run_is_incremental() {
    let mut source = FakeSource {
        rows: (1..=100)
            .map(|i| {
                ev(
                    i,
                    "DEV-A-001",
                    "1001",
                    "2026-11-08 07:00:00",
                    Some("0"),
                    Some(&format!("{i}")),
                    None,
                )
            })
            .collect(),
        ..Default::default()
    };
    let mut hrms = FakeHrms::default();
    let first = run(&mut source, &mut hrms, &cp(), "2026-11-08T04:01:00Z").unwrap();
    let persisted = serde_json::to_string(&first.checkpoint).unwrap();

    source.rows.extend((101..=103).map(|i| {
        ev(
            i,
            "DEV-A-001",
            "1001",
            "2026-11-08 16:00:00",
            Some("1"),
            Some(&format!("{i}")),
            None,
        )
    }));
    let restored: Checkpoint = serde_json::from_str(&persisted).unwrap();
    let before = source.rows_returned;
    let second = run(&mut source, &mut hrms, &restored, "2026-11-08T13:01:00Z").unwrap();
    assert_eq!(second.imported, 3);
    assert_eq!(
        source.rows_returned - before,
        5 + 3,
        "only overlap + new rows are read, never the whole table"
    );
}

#[test]
fn source_events_cannot_carry_biometric_templates() {
    let with_template = json!({
        "sourceSystem": SRC, "sourceSequence": 1, "sourceRowId": "1", "deviceSerial": "DEV-A-001",
        "deviceLocalEventId": "1", "enrollmentNumber": "1001", "eventTimeLocal": "2026-11-08T07:00:00",
        "eventTimeUtc": null, "directionRaw": "0", "sourceRecordedAt": null, "verifyMode": "FP",
        "fingerprintTemplate": "AAECAwQ="
    });
    assert!(serde_json::from_value::<SourceEvent>(with_template).is_err());
}

#[test]
fn source_provided_utc_instant_wins_over_device_local_time() {
    let mut event = ev(
        1,
        "DEV-A-001",
        "1001",
        "2026-11-08 07:00:00",
        Some("0"),
        Some("1"),
        None,
    );
    event.event_time_utc = Some(utc("2026-11-08T04:00:05Z"));
    let cmd = classify_event(&event, &devices(), &mappings(), utc("2026-11-08T04:01:00Z")).unwrap();
    assert_eq!(cmd.punch_time_source, utc("2026-11-08T04:00:05Z"));
}
