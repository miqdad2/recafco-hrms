pub mod health;

use axum::Router;
use axum::http::StatusCode;
use axum::routing::get;
use tower_http::catch_panic::CatchPanicLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

use crate::error;
use crate::state::AppState;

/// Builds the full HTTP router. RUST-01 exposes health/readiness only — no attendance endpoints.
pub fn router(state: AppState) -> Router {
    let request_timeout = state.config.request_timeout;

    Router::new()
        .route("/health", get(health::health))
        .route("/ready", get(health::ready))
        .fallback(error::not_found)
        .with_state(state)
        .layer(TimeoutLayer::with_status_code(
            StatusCode::SERVICE_UNAVAILABLE,
            request_timeout,
        ))
        .layer(CatchPanicLayer::custom(error::panic_response))
        .layer(TraceLayer::new_for_http())
}
