//! Live-database tests. Ignored by default so `cargo test` never depends on a running PostgreSQL.
//!
//! Run explicitly against a LOCAL DEVELOPMENT database only:
//!
//!   ATTENDANCE_ENGINE_TEST_DATABASE_URL=postgresql://... ./scripts/cargo.sh test --test readiness_db_test -- --ignored
//!
//! These tests only ever read. The single write *attempt* below runs inside a transaction that is
//! always rolled back, and is expected to be rejected by PostgreSQL's read-only guard anyway.

mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use recafco_attendance_engine::app;
use recafco_attendance_engine::config::ENV_DATABASE_URL;
use serde_json::Value;
use tower::ServiceExt;

fn test_url() -> String {
    std::env::var("ATTENDANCE_ENGINE_TEST_DATABASE_URL")
        .expect("set ATTENDANCE_ENGINE_TEST_DATABASE_URL to run live database tests")
}

#[tokio::test]
#[ignore = "requires a local PostgreSQL; set ATTENDANCE_ENGINE_TEST_DATABASE_URL and pass --ignored"]
async fn ready_reports_ok_and_read_only_against_live_database() {
    let url = test_url();
    let state = common::state(&[(ENV_DATABASE_URL, url.as_str())]);
    let response = app(state.clone())
        .oneshot(Request::get("/ready").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["status"], "ready");
    assert_eq!(body["checks"]["database"]["status"], "ok");
    assert_eq!(body["checks"]["database"]["read_only"], true);
    state.close().await;
}

#[tokio::test]
#[ignore = "requires a local PostgreSQL; set ATTENDANCE_ENGINE_TEST_DATABASE_URL and pass --ignored"]
async fn writes_are_rejected_by_the_session_read_only_guard() {
    let url = test_url();
    let state = common::state(&[(ENV_DATABASE_URL, url.as_str())]);
    let pool = state.db.clone().expect("pool configured");

    // Belt and braces: even if the guard were somehow missing, the transaction is rolled back.
    let mut tx = pool.begin().await.expect("begin");
    let result = sqlx::query("CREATE TABLE rust01_read_only_probe (id integer)")
        .execute(&mut *tx)
        .await;
    tx.rollback().await.expect("rollback");

    let error = result.expect_err("DDL must be rejected in a read-only session");
    let code = error
        .as_database_error()
        .and_then(|e| e.code())
        .map(|c| c.into_owned());
    // SQLSTATE 25006 = read_only_sql_transaction
    assert_eq!(code.as_deref(), Some("25006"), "unexpected error: {error}");

    // Prisma-owned tables are visible (read access works) — proves we are on the HRMS schema.
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM information_schema.tables WHERE table_name = 'attendance_raw_punches'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1, "attendance_raw_punches table should exist");
    state.close().await;
}
