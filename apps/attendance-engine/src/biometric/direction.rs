//! Punch direction (RUST-04). Direction comes ONLY from the source's explicit code or from the
//! device's configured role (entry-only / exit-only terminal). It is never inferred from event
//! order or alternation — that requires an HR-approved policy, which does not exist yet.

use super::model::DirectionMode;
use crate::domain::types::PunchType;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DirectionResolution {
    Known(PunchType),
    /// Device configured with `DirectionMode::None` (or source has no direction column).
    Unknown,
    /// The raw code is not in the configured IN/OUT code lists (e.g. break or OT codes).
    Unrecognised(String),
}

pub fn resolve_direction(mode: &DirectionMode, raw: Option<&str>) -> DirectionResolution {
    match mode {
        DirectionMode::FixedIn => DirectionResolution::Known(PunchType::In),
        DirectionMode::FixedOut => DirectionResolution::Known(PunchType::Out),
        DirectionMode::None => DirectionResolution::Unknown,
        DirectionMode::Explicit {
            in_codes,
            out_codes,
        } => match raw.map(str::trim) {
            None | Some("") => DirectionResolution::Unknown,
            Some(code) if in_codes.iter().any(|c| c == code) => {
                DirectionResolution::Known(PunchType::In)
            }
            Some(code) if out_codes.iter().any(|c| c == code) => {
                DirectionResolution::Known(PunchType::Out)
            }
            Some(code) => DirectionResolution::Unrecognised(code.to_owned()),
        },
    }
}
