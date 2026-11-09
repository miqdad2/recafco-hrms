//! Uniform JSON error responses.
//!
//! Shape: `{"error": {"code": "NOT_FOUND", "message": "..."}}`. Messages are fixed, human-safe
//! strings — internal error details (SQL errors, panics, hostnames) are logged server-side only
//! and never serialized into a response body.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("resource not found")]
    NotFound,
    #[error("internal server error")]
    Internal,
}

#[derive(Serialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    code: &'static str,
    message: &'static str,
}

impl AppError {
    fn parts(&self) -> (StatusCode, &'static str, &'static str) {
        match self {
            Self::NotFound => (StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found"),
            Self::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL_ERROR",
                "An internal error occurred",
            ),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = self.parts();
        (
            status,
            Json(ErrorBody {
                error: ErrorDetail { code, message },
            }),
        )
            .into_response()
    }
}

/// Router fallback: unknown paths get the standard JSON 404 instead of an empty body.
pub async fn not_found() -> AppError {
    AppError::NotFound
}

/// Used by `CatchPanicLayer`: the panic payload is logged, never returned to the caller.
pub fn panic_response(payload: Box<dyn std::any::Any + Send + 'static>) -> Response {
    let detail = payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_owned())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "non-string panic payload".to_owned());
    tracing::error!(panic = %detail, "request handler panicked");
    AppError::Internal.into_response()
}
