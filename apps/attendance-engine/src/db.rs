//! PostgreSQL pool construction.
//!
//! RUST-01 ownership rule: the Prisma schema in `packages/db` is authoritative and this service
//! is a strictly read-only consumer. That is enforced in two independent layers:
//!
//! 1. Operationally, by connecting as a dedicated read-only role (see README).
//! 2. In code, here: every session is started with `default_transaction_read_only=on`, so even a
//!    misconfigured URL pointing at a superuser cannot INSERT/UPDATE/DELETE/DDL through this pool.
//!    `/ready` verifies this setting on a live connection and fails closed if it is not in effect
//!    (e.g. a connection pooler that drops startup options).

use std::str::FromStr;
use std::time::Duration;

use sqlx::PgPool;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

use crate::config::DatabaseConfig;

pub const APPLICATION_NAME: &str = "recafco-attendance-engine";

/// Builds a *lazy* pool: no connection is attempted at startup. The service must be able to start
/// (and report `/ready` = 503) while PostgreSQL is down or restarting, instead of crash-looping.
pub fn build_pool(config: &DatabaseConfig) -> Result<PgPool, sqlx::Error> {
    let statement_timeout_ms = config.statement_timeout.as_millis().to_string();

    let connect_options = PgConnectOptions::from_str(config.url.expose())?
        .application_name(APPLICATION_NAME)
        .options([
            ("default_transaction_read_only", "on"),
            ("statement_timeout", statement_timeout_ms.as_str()),
        ]);

    Ok(PgPoolOptions::new()
        .max_connections(config.max_connections)
        .min_connections(config.min_connections)
        .acquire_timeout(config.acquire_timeout)
        .idle_timeout(Some(Duration::from_secs(300)))
        .test_before_acquire(true)
        .connect_lazy_with(connect_options))
}
