//! Structured logging. JSON (one object per line) by default so logs can go straight into Loki;
//! `pretty` is a development convenience only. Filtering follows `RUST_LOG` (default `info`).

use tracing_subscriber::EnvFilter;

use crate::config::LogFormat;

pub fn init(format: LogFormat) {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let builder = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true);
    // `try_init` so a second initialisation (e.g. in tests) is a no-op rather than a panic.
    let _ = match format {
        LogFormat::Json => builder
            .json()
            .flatten_event(true)
            .with_current_span(false)
            .try_init(),
        LogFormat::Pretty => builder.try_init(),
    };
}
