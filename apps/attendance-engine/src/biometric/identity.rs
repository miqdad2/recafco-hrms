//! Enrolment-number → employee resolution (RUST-04 design).
//!
//! * Never matches by name.
//! * Device-scoped mappings take precedence over source-wide mappings, so the same enrolment
//!   number on two machines can belong to two different employees.
//! * Mappings are effective-dated against the EVENT time, so transfers and re-enrolments resolve
//!   historically correctly; history is kept (rows are end-dated, never overwritten).
//! * Zero matches → unmapped; more than one match at the same scope → ambiguous. Both are held,
//!   never guessed.

use chrono::{DateTime, Utc};

use super::model::IdentityMapping;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityResolution {
    Resolved { employee_code: String },
    Unmapped,
    Ambiguous { candidates: Vec<String> },
}

fn active_at(mapping: &IdentityMapping, at: DateTime<Utc>) -> bool {
    mapping.effective_from <= at && mapping.effective_to.is_none_or(|to| at < to)
}

pub fn resolve_employee(
    mappings: &[IdentityMapping],
    source_system: &str,
    device_serial: Option<&str>,
    enrollment_number: &str,
    event_time: DateTime<Utc>,
) -> IdentityResolution {
    let candidates = |device_scoped: bool| -> Vec<&IdentityMapping> {
        mappings
            .iter()
            .filter(|m| {
                m.source_system == source_system && m.enrollment_number == enrollment_number
            })
            .filter(|m| {
                if device_scoped {
                    m.device_serial.is_some() && m.device_serial.as_deref() == device_serial
                } else {
                    m.device_serial.is_none()
                }
            })
            .filter(|m| active_at(m, event_time))
            .collect()
    };

    for scope in [true, false] {
        let found = candidates(scope);
        let mut codes: Vec<String> = found.iter().map(|m| m.employee_code.clone()).collect();
        codes.sort();
        codes.dedup();
        match codes.len() {
            0 => continue,
            1 => {
                return IdentityResolution::Resolved {
                    employee_code: codes.remove(0),
                };
            }
            _ => return IdentityResolution::Ambiguous { candidates: codes },
        }
    }
    IdentityResolution::Unmapped
}
