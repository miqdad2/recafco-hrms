#![allow(dead_code)] // each integration-test crate uses a different subset of these helpers

use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::Duration;

use recafco_attendance_engine::{AppState, Config};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// Builds a `Config` from explicit key/value pairs — never from the real process environment.
pub fn config(pairs: &[(&str, &str)]) -> Config {
    let map: HashMap<String, String> = pairs
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect();
    Config::from_lookup(move |key| map.get(key).cloned()).expect("test config must be valid")
}

pub fn state(pairs: &[(&str, &str)]) -> AppState {
    AppState::new(config(pairs)).expect("state must build")
}

/// Minimal HTTP/1.1 GET over a raw socket; returns (status code, body).
pub async fn http_get(addr: SocketAddr, path: &str) -> (u16, String) {
    let mut stream = tokio::time::timeout(Duration::from_secs(5), TcpStream::connect(addr))
        .await
        .expect("connect timed out")
        .expect("connect failed");
    let request = format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).await.unwrap();

    let mut raw = Vec::new();
    tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut raw))
        .await
        .expect("read timed out")
        .expect("read failed");
    let text = String::from_utf8_lossy(&raw).into_owned();

    let status = text
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .expect("malformed status line");
    let body = text
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_owned())
        .unwrap_or_default();
    (status, body)
}
