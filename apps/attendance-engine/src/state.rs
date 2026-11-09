use std::sync::Arc;

use sqlx::PgPool;

use crate::config::Config;
use crate::db;

/// Shared, cheaply-cloneable application state handed to every request handler.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    /// `None` when no database is configured (development only — production config refuses this).
    pub db: Option<PgPool>,
}

impl AppState {
    pub fn new(config: Config) -> Result<Self, sqlx::Error> {
        let db = config.database.as_ref().map(db::build_pool).transpose()?;
        Ok(Self {
            config: Arc::new(config),
            db,
        })
    }

    /// Closes the pool, waiting for checked-out connections to be returned.
    pub async fn close(&self) {
        if let Some(pool) = &self.db {
            pool.close().await;
        }
    }
}
