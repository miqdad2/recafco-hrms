//! Read-only incremental sync core (RUST-04). Pure orchestration over two traits so any
//! vendor/engine-specific reader can be plugged in once RECAFCO IT confirms the source:
//!
//! * `SourceReader` — READ-ONLY access to the biometric source, by source sequence, in bounded
//!   batches (never a full-table scan).
//! * `ImportSink`   — hands `ImportCommand`s to the existing NestJS device-import contract
//!   (idempotent on `(attendanceDeviceId, sourceId)`) and records held events in an exception
//!   queue.
//!
//! Guarantees:
//! * The checkpoint only advances past events that were fully handled (imported, already present,
//!   or held). On a source or sink failure the error carries the last durable checkpoint, so a
//!   restart resumes exactly there and re-reads are absorbed by idempotency.
//! * A small overlap (`overlap_sequences`) is re-read every run to catch rows that became
//!   visible late (e.g. committed out of sequence order); duplicates are absorbed by the sink.
//! * The connector never writes to the source and never reads a clock: `synced_at` is passed in.

use chrono::{DateTime, Utc};
use thiserror::Error;

use super::direction::{DirectionResolution, resolve_direction};
use super::event_key::idempotency_key;
use super::identity::{IdentityResolution, resolve_employee};
use super::model::{
    Checkpoint, DeviceRegistration, HeldEvent, HoldReason, IdentityMapping, ImportCommand,
    SourceEvent,
};
use super::timing::{assess_timing, event_time_utc};

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum SourceError {
    #[error("biometric source unavailable: {0}")]
    Unavailable(String),
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum SinkError {
    #[error("HRMS import unavailable: {0}")]
    Unavailable(String),
}

pub trait SourceReader {
    /// Events with `source_sequence > after` (all when `None`), ascending by sequence, at most
    /// `limit` rows. Must be implemented with an indexed range query, read-only.
    fn read_after(
        &mut self,
        after: Option<i64>,
        limit: usize,
    ) -> Result<Vec<SourceEvent>, SourceError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportResult {
    Created,
    AlreadyExists,
}

pub trait ImportSink {
    fn import(&mut self, command: &ImportCommand) -> Result<ImportResult, SinkError>;
    /// Upsert by `idempotency_key` into the exception queue.
    fn hold(&mut self, held: &HeldEvent) -> Result<(), SinkError>;
}

#[derive(Debug, Clone, Copy)]
pub struct ConnectorConfig {
    pub batch_size: usize,
    pub overlap_sequences: i64,
    /// Upper bound on batches per run, so one run cannot monopolise the source at peak times.
    pub max_batches_per_run: usize,
}

impl Default for ConnectorConfig {
    fn default() -> Self {
        Self {
            batch_size: 500,
            overlap_sequences: 50,
            max_batches_per_run: 20,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SyncReport {
    pub read: usize,
    pub imported: usize,
    pub already_present: usize,
    pub held: usize,
    pub checkpoint: Checkpoint,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum SyncError {
    #[error("{error}")]
    Source {
        error: SourceError,
        report: Box<SyncReport>,
    },
    #[error("{error}")]
    Sink {
        error: SinkError,
        report: Box<SyncReport>,
    },
}

/// Decide what to do with one event. Check order: device → event time → clock → identity →
/// direction. Pure; also used to re-process held events after a mapping/device fix.
pub fn classify_event(
    event: &SourceEvent,
    devices: &[DeviceRegistration],
    mappings: &[IdentityMapping],
    synced_at: DateTime<Utc>,
) -> Result<ImportCommand, Box<HeldEvent>> {
    let device = event.device_serial.as_deref().and_then(|serial| {
        devices
            .iter()
            .find(|d| d.source_system == event.source_system && d.device_serial == serial)
    });
    let event_utc = event_time_utc(event, device);
    let key = idempotency_key(event, event_utc);
    let hold = |reason| {
        Box::new(HeldEvent {
            idempotency_key: key.clone(),
            reason,
            event: event.clone(),
        })
    };

    let Some(device) = device else {
        return Err(hold(HoldReason::UnknownDevice));
    };
    if !device.active {
        return Err(hold(HoldReason::InactiveDevice));
    }
    let Some(event_utc) = event_utc else {
        return Err(hold(HoldReason::EventTimeMissing));
    };
    let timing = assess_timing(event_utc, event.source_recorded_at, synced_at);
    if timing.clock_ahead {
        return Err(hold(HoldReason::DeviceClockAhead));
    }
    let employee_code = match resolve_employee(
        mappings,
        &event.source_system,
        event.device_serial.as_deref(),
        &event.enrollment_number,
        event_utc,
    ) {
        IdentityResolution::Resolved { employee_code } => employee_code,
        IdentityResolution::Unmapped => return Err(hold(HoldReason::UnmappedEmployee)),
        IdentityResolution::Ambiguous { .. } => {
            return Err(hold(HoldReason::AmbiguousEmployeeMapping));
        }
    };
    let punch_type = match resolve_direction(&device.direction_mode, event.direction_raw.as_deref())
    {
        DirectionResolution::Known(direction) => direction,
        DirectionResolution::Unknown => return Err(hold(HoldReason::DirectionUnknown)),
        DirectionResolution::Unrecognised(_) => {
            return Err(hold(HoldReason::DirectionCodeUnrecognised));
        }
    };

    let mut flags = Vec::new();
    if timing.delayed {
        flags.push("DELAYED_SYNC".to_owned());
    }
    Ok(ImportCommand {
        attendance_device_id: device.attendance_device_id.clone(),
        source_id: key,
        employee_code,
        punch_type,
        punch_time_source: event_utc,
        synced_at,
        flags,
    })
}

/// One incremental sync run.
pub fn sync_once(
    reader: &mut dyn SourceReader,
    sink: &mut dyn ImportSink,
    devices: &[DeviceRegistration],
    mappings: &[IdentityMapping],
    checkpoint: &Checkpoint,
    config: ConnectorConfig,
    synced_at: DateTime<Utc>,
) -> Result<SyncReport, SyncError> {
    let mut report = SyncReport {
        checkpoint: checkpoint.clone(),
        ..SyncReport::default()
    };
    let mut after = checkpoint
        .last_sequence
        .map(|s| (s - config.overlap_sequences).max(0));

    for _ in 0..config.max_batches_per_run {
        let events = match reader.read_after(after, config.batch_size) {
            Ok(events) => events,
            Err(error) => {
                return Err(SyncError::Source {
                    error,
                    report: Box::new(report),
                });
            }
        };
        let batch_len = events.len();
        report.read += batch_len;

        for event in events {
            let handled = match classify_event(&event, devices, mappings, synced_at) {
                Ok(command) => sink.import(&command).map(|result| match result {
                    ImportResult::Created => report.imported += 1,
                    ImportResult::AlreadyExists => report.already_present += 1,
                }),
                Err(held) => sink.hold(&held).map(|()| report.held += 1),
            };
            if let Err(error) = handled {
                return Err(SyncError::Sink {
                    error,
                    report: Box::new(report),
                });
            }
            if let Some(sequence) = event.source_sequence {
                // Never move backwards (overlap re-reads see lower sequences again).
                report.checkpoint.last_sequence = Some(
                    report
                        .checkpoint
                        .last_sequence
                        .map_or(sequence, |s| s.max(sequence)),
                );
                after = Some(after.map_or(sequence, |a| a.max(sequence)));
            }
        }
        if batch_len < config.batch_size {
            break;
        }
    }
    Ok(report)
}
