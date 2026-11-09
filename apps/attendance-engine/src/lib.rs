//! RECAFCO HRMS attendance engine.
//!
//! RUST-01 scope: an isolated service foundation (health, readiness, config, logging, graceful
//! shutdown, read-only database pool). It performs **no** attendance processing and is **not**
//! connected to live mobile/biometric punching. The NestJS API (`apps/api`) remains the sole owner
//! of every official attendance write. See `docs/architecture/rust-attendance-engine.md`.

pub mod biometric;
pub mod config;
pub mod db;
pub mod domain;
pub mod error;
pub mod routes;
pub mod state;
pub mod telemetry;

use std::future::{Future, IntoFuture};
use std::time::Duration;

use axum::Router;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

pub use config::{Config, ConfigError};
pub use state::AppState;

/// Builds the application router for `state`.
pub fn app(state: AppState) -> Router {
    routes::router(state)
}

/// Serves `app` on `listener` until `shutdown` resolves.
///
/// After `shutdown` resolves the server stops accepting new connections and lets in-flight
/// requests finish. If they have not finished within `grace`, serving is abandoned so the process
/// can still exit (a stuck client must never block a deploy/restart indefinitely).
pub async fn serve<F>(
    listener: TcpListener,
    app: Router,
    shutdown: F,
    grace: Duration,
) -> std::io::Result<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    let (signalled_tx, signalled_rx) = oneshot::channel::<()>();
    let graceful_signal = async move {
        shutdown.await;
        tracing::info!("shutdown signal received; draining in-flight requests");
        let _ = signalled_tx.send(());
    };

    let server = axum::serve(listener, app)
        .with_graceful_shutdown(graceful_signal)
        .into_future();

    let grace_deadline = async move {
        match signalled_rx.await {
            Ok(()) => tokio::time::sleep(grace).await,
            // Sender dropped without signalling: the server finished on its own.
            Err(_) => std::future::pending::<()>().await,
        }
    };

    tokio::select! {
        result = server => result,
        () = grace_deadline => {
            tracing::warn!(grace_ms = grace.as_millis() as u64, "graceful shutdown deadline exceeded; forcing exit");
            Ok(())
        }
    }
}

/// Resolves on Ctrl+C (all platforms) or SIGTERM (Unix — what Docker/systemd send).
pub async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(error = %error, "failed to listen for Ctrl+C");
            std::future::pending::<()>().await;
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::error!(error = %error, "failed to listen for SIGTERM");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
}
