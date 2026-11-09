use std::net::SocketAddr;
use std::path::Path;
use std::process::ExitCode;

use recafco_attendance_engine::{AppState, Config, app, serve, shutdown_signal, telemetry};
use tokio::net::TcpListener;

/// Exit code for invalid/missing configuration (distinct from runtime failures = 1).
const EXIT_CONFIG: u8 = 2;

#[tokio::main]
async fn main() -> ExitCode {
    // Development convenience: load ONLY ./.env next to the engine. dotenvy's default lookup walks
    // parent directories and would otherwise pull in the monorepo root .env (NestJS secrets).
    let _ = dotenvy::from_path(Path::new(".env"));

    let config = match Config::from_env() {
        Ok(config) => config,
        Err(error) => {
            // Logging is not initialised yet (its format is itself configuration), so emit one
            // structured line by hand. ConfigError never contains secret values.
            eprintln!(
                "{}",
                serde_json::json!({
                    "level": "ERROR",
                    "target": "recafco_attendance_engine",
                    "message": "invalid configuration; refusing to start",
                    "error": error.to_string(),
                })
            );
            return ExitCode::from(EXIT_CONFIG);
        }
    };

    telemetry::init(config.log_format);

    let addr = SocketAddr::new(config.host, config.port);
    let environment = config.environment.as_str();
    let database_configured = config.database.is_some();
    let shutdown_grace = config.shutdown_grace;

    let state = match AppState::new(config) {
        Ok(state) => state,
        Err(error) => {
            tracing::error!(error = %error, "failed to initialise database pool");
            return ExitCode::from(EXIT_CONFIG);
        }
    };

    let listener = match TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(error) => {
            tracing::error!(%addr, error = %error, "failed to bind listen address (port in use?)");
            return ExitCode::FAILURE;
        }
    };

    tracing::info!(
        %addr,
        environment,
        database_configured,
        version = env!("CARGO_PKG_VERSION"),
        "attendance engine listening"
    );

    let result = serve(
        listener,
        app(state.clone()),
        shutdown_signal(),
        shutdown_grace,
    )
    .await;
    state.close().await;

    match result {
        Ok(()) => {
            tracing::info!("attendance engine stopped cleanly");
            ExitCode::SUCCESS
        }
        Err(error) => {
            tracing::error!(error = %error, "server error");
            ExitCode::FAILURE
        }
    }
}
