//! Router-level tests for `/health`, `/ready` and error responses (no network sockets).

mod common;

use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use recafco_attendance_engine::app;
use recafco_attendance_engine::config::{
    ENV_DATABASE_URL, ENV_DB_ACQUIRE_TIMEOUT_MS, ENV_READINESS_TIMEOUT_MS,
};
use serde_json::Value;
use tokio::net::TcpListener;
use tower::ServiceExt;

async fn get_json(router: axum::Router, path: &str) -> (StatusCode, Value) {
    let response = router
        .oneshot(Request::get(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .map(|v| v.to_str().unwrap().to_owned());
    assert_eq!(content_type.as_deref(), Some("application/json"), "{path}");
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).expect("body must be JSON"),
    )
}

#[tokio::test]
async fn health_reports_ok_without_any_database() {
    let (status, body) = get_json(app(common::state(&[])), "/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["service"], "recafco-attendance-engine");
    assert_eq!(body["status"], "ok");
    assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));
}

#[tokio::test]
async fn ready_is_unavailable_when_database_not_configured() {
    let (status, body) = get_json(app(common::state(&[])), "/ready").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["status"], "unavailable");
    assert_eq!(body["checks"]["database"]["status"], "not_configured");
}

#[tokio::test]
async fn ready_is_unavailable_when_database_refuses_connections() {
    // Port 1 on loopback: nothing listens there, so the connection is refused immediately.
    let state = common::state(&[
        (
            ENV_DATABASE_URL,
            "postgresql://engine_ro:topsecret@127.0.0.1:1/recafco_hrms_dev",
        ),
        (ENV_DB_ACQUIRE_TIMEOUT_MS, "500"),
        (ENV_READINESS_TIMEOUT_MS, "3000"),
    ]);
    let (status, body) = get_json(app(state), "/ready").await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["status"], "unavailable");
    let db_status = body["checks"]["database"]["status"].as_str().unwrap();
    assert!(
        db_status == "unreachable" || db_status == "timeout",
        "got {db_status}"
    );
    let raw = body.to_string();
    assert!(!raw.contains("topsecret"), "credentials leaked: {raw}");
    assert!(
        !raw.to_lowercase().contains("refused"),
        "driver error leaked: {raw}"
    );
}

#[tokio::test]
async fn ready_times_out_when_database_never_answers() {
    // A TCP server that accepts connections and then says nothing: the PostgreSQL handshake hangs,
    // so only the readiness timeout can end the check.
    let silent = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = silent.local_addr().unwrap();
    tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((socket, _)) = silent.accept().await {
            held.push(socket);
        }
    });

    let url = format!("postgresql://engine_ro:pw@{addr}/recafco_hrms_dev");
    let state = common::state(&[
        (ENV_DATABASE_URL, url.as_str()),
        (ENV_DB_ACQUIRE_TIMEOUT_MS, "10000"),
        (ENV_READINESS_TIMEOUT_MS, "300"),
    ]);

    let started = std::time::Instant::now();
    let (status, body) = get_json(app(state), "/ready").await;
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "readiness must be bounded"
    );
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["checks"]["database"]["status"], "timeout");
}

#[tokio::test]
async fn unknown_route_returns_json_404() {
    let (status, body) = get_json(app(common::state(&[])), "/attendance/punches").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"]["code"], "NOT_FOUND");
}

#[tokio::test]
async fn no_attendance_write_endpoints_exist_in_rust_01() {
    for path in [
        "/punches",
        "/summaries/recalculate",
        "/v1/attendance/evaluate",
    ] {
        let response = app(common::state(&[]))
            .oneshot(Request::post(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
    }
}
