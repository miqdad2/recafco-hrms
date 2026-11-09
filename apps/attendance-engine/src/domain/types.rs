//! Enums mirroring the Prisma schema (`packages/db/prisma/schema.prisma`) value-for-value.
//! Serialized names are the exact database/API strings (`"IN"`, `"REJECTED_FAKE_GPS"`, ...).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PunchType {
    In,
    Out,
    BreakStart,
    BreakEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AttendanceSourceType {
    Mobile,
    BiometricDevice,
    FaceDevice,
    CardDevice,
    Web,
    ManualCorrection,
    Import,
    FutureIntegration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PunchValidationStatus {
    Accepted,
    AcceptedWithWarning,
    RejectedOutsideLocation,
    RejectedFakeGps,
    RejectedUnregisteredDevice,
    RejectedEmployeeInactive,
    RejectedDuplicate,
    PendingHrReview,
    PendingManagerApproval,
    RejectedPolicyViolation,
}

impl PunchValidationStatus {
    /// Severity ranking — identical to `STATUS_SEVERITY` in `AttendanceValidationService`.
    pub fn severity(self) -> u8 {
        match self {
            Self::RejectedEmployeeInactive => 100,
            Self::RejectedDuplicate => 95,
            Self::RejectedUnregisteredDevice => 90,
            Self::RejectedFakeGps => 85,
            Self::RejectedOutsideLocation => 80,
            Self::RejectedPolicyViolation => 75,
            Self::PendingManagerApproval => 50,
            Self::PendingHrReview => 40,
            Self::AcceptedWithWarning => 10,
            Self::Accepted => 0,
        }
    }

    /// NestJS tests `validationStatus.startsWith('ACCEPTED')`.
    pub fn is_accepted(self) -> bool {
        matches!(self, Self::Accepted | Self::AcceptedWithWarning)
    }
}

/// `DailyAttendanceStatus`. The current calculator only ever produces PRESENT, LATE,
/// MISSING_PUNCH and ABSENT; the other values exist in the schema but are never assigned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DailyAttendanceStatus {
    Present,
    Absent,
    Late,
    HalfDay,
    Leave,
    WeekOff,
    Holiday,
    MissingPunch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EmployeeStatus {
    Active,
    Inactive,
    OnLeave,
    Resigned,
    Terminated,
}

impl EmployeeStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "ACTIVE",
            Self::Inactive => "INACTIVE",
            Self::OnLeave => "ON_LEAVE",
            Self::Resigned => "RESIGNED",
            Self::Terminated => "TERMINATED",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MobileDeviceStatus {
    PendingApproval,
    Approved,
    Blocked,
    Deactivated,
}

impl MobileDeviceStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PendingApproval => "PENDING_APPROVAL",
            Self::Approved => "APPROVED",
            Self::Blocked => "BLOCKED",
            Self::Deactivated => "DEACTIVATED",
        }
    }
}
