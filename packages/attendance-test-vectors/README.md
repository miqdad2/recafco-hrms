# Attendance test vectors (RUST-02)

Shared, versioned, synthetic scenarios that prove the Rust attendance engine (`apps/attendance-engine/src/domain`) makes **exactly** the same validation decisions as the NestJS implementation (`AttendanceValidationService`). It contains no real personal data.

This directory has no `package.json`, so pnpm and turbo ignore it.

| File | Purpose |
| --- | --- |
| `build-validation-scenarios.mjs` | Generator for the scenario inputs. Edit it and re-run; don't hand-edit the JSON. |
| `validation-v1.scenarios.json` | 67 scenario **inputs** (55 `validation`, 12 `mobileIntake`). Schema `recafco-attendance-validation-scenarios/1`. |
| `validation-v1.expected.json` | **Expected outcomes**, recorded once from the unmodified NestJS code, reviewed line by line, and frozen. Schema `recafco-attendance-validation-expected/1`. |
| `parity-compare.cjs` | The canonical comparator (a library plus a CLI for the direct NestJS↔Rust cross-check). `--summary` switches to the daily-summary contract, where every field must match exactly. |
| `build-summary-scenarios.mjs` | Generator for the daily-summary scenarios (RUST-03). |
| `summary-v1.scenarios.json` | 48 daily-summary **inputs**: employee, work date, punches with status/source/official instant/prior `isOfficial`, shift assignments, existing summary, period lock. Schema `recafco-attendance-summary-scenarios/1`. |
| `summary-v1.expected.json` | **Expected outcomes** recorded from the unmodified `AttendanceSummaryCalculatorService.calculateForEmployeeDate`, reviewed and frozen. Contract `attendance-daily-summary-result/1`. |

Daily-summary parity:
- NestJS: `apps/api/test/parity/summary-parity.spec.ts`
- Rust: `apps/attendance-engine/tests/summary_parity_test.rs`
- Cross-check: `node parity-compare.cjs --summary apps/api/test-output/parity/nest-summary-results.json apps/attendance-engine/target/parity/rust-summary-results.json`

Summary outcome fields:
- `outcome` (`CALCULATED` | `REFUSED_LOCKED_PERIOD` | `REFUSED_LOCKED_SUMMARY`)
- official IN/OUT punch ids, times and source types
- worked/late/early-leave/overtime minutes, `status`, `calculationVersion`
- `officialPunchIds` (every `isOfficial` punch afterwards, sorted)

## Versions

- `rulesetVersion`: `nest-post-time01-2026-11-08`, the NestJS rules after TIME-01. The Rust constant `RULESET_VERSION` must match, or the Rust parity test fails.
- `resultContractVersion`: `attendance-validation-result/1`, the outcome shape below.

Any intentional rule change in NestJS requires all of the following:
1. Bump `rulesetVersion`.
2. Re-record the expected file (`PARITY_RECORD=1`).
3. Review the diff by hand.
4. Implement the same change in Rust.

## Scenario input format

- **`kind: "validation"`**: the input is the `ValidationInput` type in `apps/attendance-engine/src/domain/input.rs`.
  - Fields: `punch`, `employee`, `workLocations`, `mobileDevices`, `attendanceDevices`, `earlierPunches` (ascending by `(createdAt, id)`, all before the subject punch), `otherExistingPunchIds`, `lockedWorkDates`.
  - Ids are fixture refs (`emp-1`, `loc-hq`, `mdev-1`, …). The NestJS harness seeds them as real rows and maps database ids back to refs.
- **`kind: "mobileIntake"`**: the input is `MobileIntakeInput`: `serverReceivedAt` (the trusted clock) plus the app's `request` and the same context facts. It exercises the TIME-01 intake (`createMobile`) followed by validation.

## Outcome contract (`attendance-validation-result/1`)

```json
{
  "validationStatus": "REJECTED_OUTSIDE_LOCATION",
  "fraudScore": 70,
  "fraudFlags": [{ "flag": "CLIENT_REPORTED_SIGNALS", "signals": {} }, { "source": "VALIDATION_ENGINE", "flag": "OUTSIDE_GEOFENCE", "distanceMeters": 1112, "allowedRadiusMeters": 100 }],
  "distanceFromLocationMeters": 1111.949,
  "duplicateOfPunchId": null,
  "workDate": "2026-11-08",
  "punchTimeSource": "2026-11-08T06:00:00.000Z",
  "clientReportedTime": null
}
```

## Comparison rules

- **Exact match:** `validationStatus`, `fraudScore`, `duplicateOfPunchId`, `workDate`, `punchTimeSource`, `clientReportedTime`. Numbers are compared by value (`250` equals `250.0`).
- **Fraud flags:** each flag is canonicalised as key-sorted JSON and compared as a multiset. Their **order** is checked separately and must also match.
- **The only tolerance:** `distanceFromLocationMeters` within `1e-6` m. Haversine maths in V8 and Rust's libm may differ in the last bits; the observed maximum difference is 2.3e-13 m.

## Running

```bash
# NestJS side: guarded, disposable recafco_hrms_test only (see docs/incidents)
cd apps/api && RECAFCO_TEST_DB_RESET=ALLOW_TRUNCATE_recafco_hrms_test pnpm exec jest test/parity
# Rust side
cd apps/attendance-engine && ./scripts/cargo.sh test --test parity_test
# Direct cross-check of the two result files
node packages/attendance-test-vectors/parity-compare.cjs apps/api/test-output/parity/nest-results.json apps/attendance-engine/target/parity/rust-results.json
```
