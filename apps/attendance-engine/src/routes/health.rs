//! Liveness (`/health`) and readiness (`/ready`).
//!
//! * `/health` answers "is the process up and serving HTTP?" — it never touches dependencies, so
//!   a PostgreSQL outage does not make a process manager restart a healthy engine.
//! * `/ready` answers "can this instance do real work right now?" — it checks the database on a
//!   live connection and returns 503 with a machine-readable reason otherwise. It never reports
//!   success for a dependency it did not actually reach, and never returns raw driver errors.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use sqlx::PgPool;

use crate::state::AppState;

pub const SERVICE_NAME: &str = "recafco-attendance-engine";

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub service: &'static str,
    pub status: &'static str,
    pub version: &'static str,
}

pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        service: SERVICE_NAME,
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseStatus {
    Ok,
    /// No `ATTENDANCE_ENGINE_DATABASE_URL` (development only).
    NotConfigured,
    /// Connection/auth/query failed.
    Unreachable,
    /// The check did not finish within `ATTENDANCE_ENGINE_READINESS_TIMEOUT_MS`.
    Timeout,
    /// Connected, but the session is NOT read-only — fail closed (RUST-01 ownership rule).
    NotReadOnly,
}

#[derive(Debug, Serialize)]
pub struct DatabaseCheck {
    pub status: DatabaseStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pool: Option<PoolStats>,
}

#[derive(Debug, Serialize)]
pub struct PoolStats {
    pub size: u32,
    pub idle: usize,
    pub max: u32,
}

#[derive(Debug, Serialize)]
pub struct ReadinessChecks {
    pub database: DatabaseCheck,
}

#[derive(Debug, Serialize)]
pub struct ReadinessResponse {
    pub service: &'static str,
    pub status: &'static str,
    pub checks: ReadinessChecks,
}

pub async fn ready(State(state): State<AppState>) -> Response {
    let database = check_database(&state).await;
    let is_ready = database.status == DatabaseStatus::Ok;

    let body = ReadinessResponse {
        service: SERVICE_NAME,
        status: if is_ready { "ready" } else { "unavailable" },
        checks: ReadinessChecks { database },
    };
    let code = if is_ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (code, Json(body)).into_response()
}

async fn check_database(state: &AppState) -> DatabaseCheck {
    let Some(pool) = &state.db else {
        return DatabaseCheck {
            status: DatabaseStatus::NotConfigured,
            read_only: None,
            pool: None,
        };
    };

    let probe = tokio::time::timeout(state.config.readiness_timeout, probe_read_only(pool)).await;
    let (status, read_only) = match probe {
        Err(_) => {
            tracing::warn!("readiness: database check timed out");
            (DatabaseStatus::Timeout, None)
        }
        Ok(Err(error)) => {
            // Logged for operators; deliberately not echoed in the response body.
            tracing::warn!(error = %error, "readiness: database unreachable");
            (DatabaseStatus::Unreachable, None)
        }
        Ok(Ok(true)) => (DatabaseStatus::Ok, Some(true)),
        Ok(Ok(false)) => {
            tracing::error!(
                "readiness: database session is NOT read-only; refusing to report ready"
            );
            (DatabaseStatus::NotReadOnly, Some(false))
        }
    };

    DatabaseCheck {
        status,
        read_only,
        pool: Some(PoolStats {
            size: pool.size(),
            idle: pool.num_idle(),
            max: pool.options().get_max_connections(),
        }),
    }
}

/// Runs one round-trip on a real pooled connection and reports whether the session-level
/// read-only guard is actually in effect.
async fn probe_read_only(pool: &PgPool) -> Result<bool, sqlx::Error> {
    let setting: String = sqlx::query_scalar("SHOW default_transaction_read_only")
        .fetch_one(pool)
        .await?;
    Ok(setting.eq_ignore_ascii_case("on"))
}
