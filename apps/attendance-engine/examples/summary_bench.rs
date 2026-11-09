//! RUST-03 pure-function daily-summary benchmark (no I/O, no database, no network).
//!
//!   ./scripts/cargo.sh run --release --example summary_bench
//!
//! Synthetic, deterministic inputs (fixed-seed LCG): each employee-day has 2–6 punches from mixed
//! mobile/biometric sources with a realistic share of rejected/duplicate/pending punches, plus one
//! or two shift assignments. Inputs are generated BEFORE timing. This measures the calculation
//! function only — not database reads/writes, HTTP, or recalculation scheduling.

use std::hint::black_box;
use std::time::{Duration, Instant};

use chrono::{DateTime, Duration as ChronoDuration, NaiveDate, Utc};
use recafco_attendance_engine::domain::punch_pairing::SummaryPunch;
use recafco_attendance_engine::domain::shift::{ShiftAssignmentContext, ShiftContext};
use recafco_attendance_engine::domain::summary::{
    SummaryInput, calculate_daily_summary, kuwait_day_range,
};
use recafco_attendance_engine::domain::types::{
    AttendanceSourceType, PunchType, PunchValidationStatus,
};

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

fn shift(id: &str, start: i64, end: i64) -> ShiftContext {
    ShiftContext {
        id: id.into(),
        start_time_minutes: start,
        end_time_minutes: end,
        is_overnight: end <= start,
        grace_period_minutes: 15,
        break_minutes: 60,
        is_active: true,
    }
}

fn make_input(rng: &mut Lcg, employee: usize, work_date: NaiveDate) -> SummaryInput {
    let (day_start, _) = kuwait_day_range(work_date);
    let at = |minutes: i64, seconds: i64| -> DateTime<Utc> {
        day_start + ChronoDuration::seconds(minutes * 60 + seconds)
    };
    let source = |rng: &mut Lcg| {
        if rng.below(2) == 0 {
            AttendanceSourceType::Mobile
        } else {
            AttendanceSourceType::BiometricDevice
        }
    };
    let status = |rng: &mut Lcg| match rng.below(20) {
        0 => PunchValidationStatus::RejectedOutsideLocation,
        1 => PunchValidationStatus::RejectedDuplicate,
        2 => PunchValidationStatus::PendingHrReview,
        3 => PunchValidationStatus::AcceptedWithWarning,
        _ => PunchValidationStatus::Accepted,
    };

    let count = 2 + rng.below(5) as usize;
    let punches = (0..count)
        .map(|i| {
            let is_in = i % 2 == 0;
            let base = if is_in { 400 } else { 950 } as i64;
            SummaryPunch {
                id: format!("e{employee}-{work_date}-{i}"),
                punch_type: if is_in { PunchType::In } else { PunchType::Out },
                source_type: source(rng),
                validation_status: status(rng),
                punch_time_source: at(base + rng.below(90) as i64, rng.below(60) as i64),
                is_official: false,
            }
        })
        .collect();

    let mut shift_assignments = vec![ShiftAssignmentContext {
        id: format!("sa-{employee}-a"),
        effective_from: day_start - ChronoDuration::days(300),
        effective_to: None,
        shift: shift("day", 420, 960),
    }];
    if rng.below(4) == 0 {
        shift_assignments.push(ShiftAssignmentContext {
            id: format!("sa-{employee}-b"),
            effective_from: day_start - ChronoDuration::days(3),
            effective_to: None,
            shift: shift("late", 540, 1080),
        });
    }

    SummaryInput {
        employee_id: format!("emp-{employee}"),
        work_date,
        punches,
        shift_assignments,
        existing_summary: None,
        period_locked: false,
    }
}

fn batch(rng: &mut Lcg, employees: usize, days: usize) -> Vec<SummaryInput> {
    let first = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
    (0..days)
        .flat_map(|d| (0..employees).map(move |e| (e, first + ChronoDuration::days(d as i64))))
        .map(|(e, date)| make_input(rng, e, date))
        .collect()
}

fn run_batch(label: &str, inputs: &[SummaryInput], repeats: u32) {
    for input in inputs.iter().take(1000) {
        black_box(calculate_daily_summary(input)); // warm-up
    }
    let mut best = Duration::MAX;
    for _ in 0..repeats {
        let start = Instant::now();
        for input in inputs {
            black_box(calculate_daily_summary(black_box(input)));
        }
        best = best.min(start.elapsed());
    }
    println!(
        "{label:<40} {:>7} employee-days  best of {repeats}: {:>10.3?}  ({:>9.0} summaries/s)",
        inputs.len(),
        best,
        inputs.len() as f64 / best.as_secs_f64()
    );
}

fn main() {
    let mut rng = Lcg(0x5EC4_F00D);

    // One employee-day: latency distribution over repeated calls on varied inputs.
    let singles = batch(&mut rng, 1000, 1);
    let mut samples: Vec<Duration> = Vec::with_capacity(200_000);
    for i in 0..200_000 {
        let input = &singles[i % singles.len()];
        let start = Instant::now();
        black_box(calculate_daily_summary(black_box(input)));
        samples.push(start.elapsed());
    }
    samples.sort_unstable();
    let pct = |p: f64| samples[((samples.len() as f64 - 1.0) * p) as usize];
    println!(
        "one employee-day latency: p50={:?} p90={:?} p99={:?} p99.9={:?} max={:?}",
        pct(0.5),
        pct(0.9),
        pct(0.99),
        pct(0.999),
        samples[samples.len() - 1]
    );

    run_batch("1,000 employee-days (1 day)", &batch(&mut rng, 1000, 1), 20);
    run_batch("2,000 employee-days (1 day)", &batch(&mut rng, 2000, 1), 20);
    let month = batch(&mut rng, 2000, 31);
    run_batch("2,000 employees x 31 days (one month)", &month, 5);

    let punches: usize = month.iter().map(|i| i.punches.len()).sum();
    println!(
        "month input set: {} employee-days, {punches} punches (held in memory)",
        month.len()
    );
}
