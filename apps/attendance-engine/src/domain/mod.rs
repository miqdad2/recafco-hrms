//! Attendance domain logic (RUST-02): pure, I/O-free, clock-free ports of the post-TIME-01
//! NestJS validation rules. Proven equivalent to `AttendanceValidationService` by the shared
//! fixtures in `packages/attendance-test-vectors` (see `tests/parity_test.rs` and
//! `apps/api/test/parity/validation-parity.spec.ts`).
//!
//! Not wired to any HTTP route or database: NestJS remains the sole writer of attendance.

pub mod duplicate;
pub mod fraud;
pub mod geo;
pub mod input;
pub mod punch_pairing;
pub mod shift;
pub mod summary;
pub mod summary_status;
pub mod time;
pub mod types;
pub mod validation;
pub mod working_time;

pub use input::ValidationInput;
pub use summary::{
    SUMMARY_RESULT_CONTRACT_VERSION, SummaryInput, SummaryOutcome, calculate_daily_summary,
};
pub use validation::{
    MobileIntakeInput, RESULT_CONTRACT_VERSION, RULESET_VERSION, ValidationOutcome, validate,
    validate_mobile_intake,
};
