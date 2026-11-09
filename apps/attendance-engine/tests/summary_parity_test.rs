//! RUST-03 Rust side of the daily-summary parity check.
//!
//! Runs every scenario in `packages/attendance-test-vectors/summary-v1.scenarios.json` through the
//! pure Rust summary engine and compares with `summary-v1.expected.json` (recorded from the
//! unmodified NestJS calculator, reviewed, frozen). EVERY field must match exactly — summaries have
//! no floating-point fields, so there is no tolerance. Writes `target/parity/rust-summary-results.json`
//! for the direct NestJS↔Rust cross-check (`parity-compare.cjs --summary`).

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use recafco_attendance_engine::domain::{
    RULESET_VERSION, SUMMARY_RESULT_CONTRACT_VERSION, SummaryInput, calculate_daily_summary,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioDoc {
    ruleset_version: String,
    result_contract_version: String,
    scenarios: Vec<Scenario>,
}

#[derive(Deserialize)]
struct Scenario {
    id: String,
    input: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedDoc {
    ruleset_version: String,
    outcomes: BTreeMap<String, Value>,
}

fn vectors_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/attendance-test-vectors")
}

fn load() -> (ScenarioDoc, ExpectedDoc) {
    let read = |name: &str| std::fs::read_to_string(vectors_dir().join(name)).unwrap();
    (
        serde_json::from_str(&read("summary-v1.scenarios.json")).unwrap(),
        serde_json::from_str(&read("summary-v1.expected.json")).unwrap(),
    )
}

fn field_differences(expected: &Value, actual: &Value) -> Vec<String> {
    let keys: BTreeSet<&String> = expected
        .as_object()
        .unwrap()
        .keys()
        .chain(actual.as_object().unwrap().keys())
        .collect();
    keys.into_iter()
        .filter(|k| expected.get(*k) != actual.get(*k))
        .map(|k| {
            format!(
                "{k}: expected {:?} got {:?}",
                expected.get(k),
                actual.get(k)
            )
        })
        .collect()
}

#[test]
fn rust_summary_engine_matches_recorded_nestjs_outcomes_for_every_scenario() {
    let (scenarios, expected) = load();
    assert_eq!(scenarios.ruleset_version, RULESET_VERSION);
    assert_eq!(expected.ruleset_version, RULESET_VERSION);
    assert_eq!(
        scenarios.result_contract_version,
        SUMMARY_RESULT_CONTRACT_VERSION
    );

    let mut results = BTreeMap::new();
    let mut failures = Vec::new();
    for scenario in &scenarios.scenarios {
        let input: SummaryInput = serde_json::from_value(scenario.input.clone())
            .unwrap_or_else(|e| panic!("{}: bad input: {e}", scenario.id));
        let actual = serde_json::to_value(calculate_daily_summary(&input)).unwrap();
        match expected.outcomes.get(&scenario.id) {
            None => failures.push(format!("{}: no expected outcome", scenario.id)),
            Some(want) => {
                let differences = field_differences(want, &actual);
                if !differences.is_empty() {
                    failures.push(format!("{}: {}", scenario.id, differences.join("; ")));
                }
            }
        }
        results.insert(scenario.id.clone(), actual);
    }

    let out_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/parity");
    std::fs::create_dir_all(&out_dir).unwrap();
    let document = json!({
        "producer": "rust",
        "rulesetVersion": RULESET_VERSION,
        "resultContractVersion": SUMMARY_RESULT_CONTRACT_VERSION,
        "outcomes": results,
    });
    std::fs::write(
        out_dir.join("rust-summary-results.json"),
        serde_json::to_string_pretty(&document).unwrap(),
    )
    .unwrap();

    assert!(
        failures.is_empty(),
        "{} of {} summary scenarios differ from NestJS:\n{}",
        failures.len(),
        scenarios.scenarios.len(),
        failures.join("\n")
    );
    assert_eq!(results.len(), expected.outcomes.len());
}

#[test]
fn summary_calculation_is_deterministic_and_input_order_independent_without_ties() {
    let (scenarios, _) = load();
    for scenario in &scenarios.scenarios {
        let input: SummaryInput = serde_json::from_value(scenario.input.clone()).unwrap();
        let mut reversed = input.clone();
        reversed.punches.reverse();
        reversed.shift_assignments.reverse();
        assert_eq!(
            calculate_daily_summary(&input),
            calculate_daily_summary(&input),
            "{}",
            scenario.id
        );
        assert_eq!(
            calculate_daily_summary(&input),
            calculate_daily_summary(&reversed),
            "{}: result depends on input order",
            scenario.id
        );
    }
}
