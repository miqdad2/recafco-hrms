//! Startup / shutdown behaviour: real sockets, the real `serve` function, and the real binary.

mod common;

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use axum::Router;
use axum::routing::get;
use recafco_attendance_engine::{app, serve};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

const BIN: &str = env!("CARGO_BIN_EXE_recafco-attendance-engine");

#[tokio::test]
async fn serves_requests_then_shuts_down_gracefully() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (stop_tx, stop_rx) = oneshot::channel::<()>();

    let server = tokio::spawn(serve(
        listener,
        app(common::state(&[])),
        async {
            let _ = stop_rx.await;
        },
        Duration::from_secs(5),
    ));

    let (status, body) = common::http_get(addr, "/health").await;
    assert_eq!(status, 200);
    assert!(body.contains("\"status\":\"ok\""), "{body}");

    stop_tx.send(()).unwrap();
    let result = tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .expect("server did not stop within 5s")
        .expect("server task panicked");
    assert!(result.is_ok(), "serve returned error: {result:?}");

    assert!(
        TcpStream::connect(addr).await.is_err(),
        "listener must be closed after shutdown"
    );
}

#[tokio::test]
async fn in_flight_request_completes_during_graceful_shutdown() {
    let router = Router::new().route(
        "/slow",
        get(|| async {
            tokio::time::sleep(Duration::from_millis(300)).await;
            "done"
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (stop_tx, stop_rx) = oneshot::channel::<()>();
    let server = tokio::spawn(serve(
        listener,
        router,
        async {
            let _ = stop_rx.await;
        },
        Duration::from_secs(5),
    ));

    let request = tokio::spawn(common::http_get(addr, "/slow"));
    tokio::time::sleep(Duration::from_millis(100)).await; // request is now in flight
    stop_tx.send(()).unwrap();

    let (status, body) = request.await.unwrap();
    assert_eq!(status, 200);
    assert_eq!(body, "done");
    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .expect("server did not stop")
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn shutdown_is_forced_after_grace_period() {
    let router = Router::new().route(
        "/stuck",
        get(|| async {
            tokio::time::sleep(Duration::from_secs(60)).await;
            "never"
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (stop_tx, stop_rx) = oneshot::channel::<()>();
    let server = tokio::spawn(serve(
        listener,
        router,
        async {
            let _ = stop_rx.await;
        },
        Duration::from_millis(200),
    ));

    let _stuck = tokio::spawn(common::http_get(addr, "/stuck"));
    tokio::time::sleep(Duration::from_millis(100)).await;
    let started = Instant::now();
    stop_tx.send(()).unwrap();

    tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .expect("grace deadline was not enforced")
        .unwrap()
        .unwrap();
    assert!(started.elapsed() >= Duration::from_millis(200));
}

// ---------------------------------------------------------------------------------------------
// Binary-level tests: run the compiled executable with a fully controlled environment, from an
// empty working directory (so no developer .env is picked up).
// ---------------------------------------------------------------------------------------------

fn isolated_dir(name: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("recafco-engine-test-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn engine_command(name: &str, vars: &[(&str, &str)]) -> Command {
    let mut command = Command::new(BIN);
    command
        .env_clear()
        .current_dir(isolated_dir(name))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Windows needs these for process/socket initialisation.
    for key in ["SystemRoot", "SYSTEMROOT", "windir", "PATH", "Path"] {
        if let Ok(value) = std::env::var(key) {
            command.env(key, value);
        }
    }
    for (key, value) in vars {
        command.env(key, value);
    }
    command
}

#[test]
fn binary_refuses_to_start_in_production_without_database_url() {
    let output = engine_command("prod-no-db", &[("ATTENDANCE_ENGINE_ENV", "production")])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("ATTENDANCE_ENGINE_DATABASE_URL"),
        "{stderr}"
    );
    assert!(stderr.contains("\"level\":\"ERROR\""), "{stderr}");
}

#[test]
fn binary_rejects_invalid_port() {
    let output = engine_command("bad-port", &[("ATTENDANCE_ENGINE_PORT", "not-a-port")])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("ATTENDANCE_ENGINE_PORT"));
}

#[test]
fn binary_rejects_malformed_database_url_without_leaking_it() {
    let output = engine_command(
        "bad-url",
        &[(
            "ATTENDANCE_ENGINE_DATABASE_URL",
            "mysql://root:Hunter2Secret@db/x",
        )],
    )
    .output()
    .unwrap();
    assert_eq!(output.status.code(), Some(2));
    let all = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!all.contains("Hunter2Secret"), "secret leaked: {all}");
}

#[test]
fn binary_exits_non_zero_when_port_is_already_in_use() {
    let occupied = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = occupied.local_addr().unwrap().port().to_string();
    let output = engine_command("port-busy", &[("ATTENDANCE_ENGINE_PORT", port.as_str())])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    drop(occupied);
}

#[tokio::test]
async fn binary_starts_and_serves_health_on_configured_port() {
    let port = {
        let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        probe.local_addr().unwrap().port()
    };
    let port_str = port.to_string();
    let mut child = engine_command("start", &[("ATTENDANCE_ENGINE_PORT", port_str.as_str())])
        .spawn()
        .unwrap();

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut served = None;
    while Instant::now() < deadline {
        if TcpStream::connect(addr).await.is_ok() {
            served = Some(common::http_get(addr, "/health").await);
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    child.kill().ok();
    let _ = child.wait();

    let (status, body) = served.expect("binary never started listening");
    assert_eq!(status, 200);
    assert!(
        body.contains("\"service\":\"recafco-attendance-engine\""),
        "{body}"
    );
}
