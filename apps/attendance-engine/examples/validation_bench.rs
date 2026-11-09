//! RUST-02 pure-function validation benchmark (no I/O, no database, no network).
//!
//!   ./scripts/cargo.sh run --release --example validation_bench -- [iterations]
//!
//! Inputs: every scenario in packages/attendance-test-vectors/validation-v1.scenarios.json
//! (a representative mix: clean, rejected, duplicate, intake), parsed once up front. Measures
//! single-thread latency distribution and throughput, then multi-thread throughput. This
//! measures the decision function ONLY — it says nothing about end-to-end HRMS punch latency,
//! which is dominated by HTTP, auth and PostgreSQL.

use std::hint::black_box;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use recafco_attendance_engine::domain::{
    MobileIntakeInput, ValidationInput, validate, validate_mobile_intake,
};
use serde_json::Value;

enum Case {
    Validation(Box<ValidationInput>),
    Intake(Box<MobileIntakeInput>),
}

fn run(case: &Case) -> usize {
    match case {
        Case::Validation(input) => validate(input).fraud_flags.len(),
        Case::Intake(input) => validate_mobile_intake(input).fraud_flags.len(),
    }
}

fn load_cases() -> Vec<Case> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/attendance-test-vectors/validation-v1.scenarios.json");
    let doc: Value =
        serde_json::from_str(&std::fs::read_to_string(path).expect("scenarios")).expect("json");
    doc["scenarios"]
        .as_array()
        .expect("scenarios array")
        .iter()
        .map(|s| match s["kind"].as_str() {
            Some("validation") => Case::Validation(Box::new(
                serde_json::from_value(s["input"].clone()).expect("input"),
            )),
            _ => Case::Intake(Box::new(
                serde_json::from_value(s["input"].clone()).expect("input"),
            )),
        })
        .collect()
}

fn percentile(sorted: &[Duration], p: f64) -> Duration {
    let index = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[index]
}

fn main() {
    let iterations: usize = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(1_000_000);
    let cases = load_cases();
    println!(
        "cases: {} scenario inputs, iterations: {iterations}",
        cases.len()
    );

    // Warm-up.
    for i in 0..50_000 {
        black_box(run(&cases[i % cases.len()]));
    }

    // Single-thread latency distribution (per-call timing on a 200k sample).
    let sample = 200_000.min(iterations);
    let mut latencies = Vec::with_capacity(sample);
    for i in 0..sample {
        let case = &cases[i % cases.len()];
        let start = Instant::now();
        black_box(run(black_box(case)));
        latencies.push(start.elapsed());
    }
    latencies.sort_unstable();
    println!(
        "single-thread latency per validation: p50={:?} p90={:?} p99={:?} p99.9={:?} max={:?}",
        percentile(&latencies, 0.50),
        percentile(&latencies, 0.90),
        percentile(&latencies, 0.99),
        percentile(&latencies, 0.999),
        latencies[latencies.len() - 1]
    );

    // Single-thread throughput (no per-call timer overhead).
    let start = Instant::now();
    for i in 0..iterations {
        black_box(run(black_box(&cases[i % cases.len()])));
    }
    let elapsed = start.elapsed();
    println!(
        "single-thread throughput: {:.0} validations/s ({iterations} in {:?})",
        iterations as f64 / elapsed.as_secs_f64(),
        elapsed
    );

    // Multi-thread throughput (embarrassingly parallel: pure function, shared read-only inputs).
    let threads = std::thread::available_parallelism()
        .map_or(4, |n| n.get())
        .min(4);
    let per_thread = iterations / threads;
    let start = Instant::now();
    std::thread::scope(|scope| {
        for t in 0..threads {
            let cases = &cases;
            scope.spawn(move || {
                for i in 0..per_thread {
                    black_box(run(black_box(&cases[(i + t) % cases.len()])));
                }
            });
        }
    });
    let elapsed = start.elapsed();
    println!(
        "{threads}-thread throughput: {:.0} validations/s ({} in {:?})",
        (per_thread * threads) as f64 / elapsed.as_secs_f64(),
        per_thread * threads,
        elapsed
    );
}
