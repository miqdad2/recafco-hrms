#!/usr/bin/env node
/**
 * Canonical comparison of attendance-validation outcomes (contract attendance-validation-result/1).
 * Used by the NestJS parity spec and as a CLI for the direct NestJS↔Rust cross-check.
 *
 * Exact equality is required for every business field. The ONLY tolerance is
 * DISTANCE_TOLERANCE_METERS on `distanceFromLocationMeters`, because the haversine formula is
 * evaluated in two languages' floating-point maths. Flags are compared as a multiset of
 * canonical (key-sorted) JSON, and their order is checked and reported separately.
 * Numbers compare by value (JSON 250 === 250.0).
 *
 * CLI: node parity-compare.cjs <nest-results.json> <rust-results.json> [report-out.json]
 */
const fs = require('node:fs');

const DISTANCE_TOLERANCE_METERS = 1e-6;
const EXACT_FIELDS = ['validationStatus', 'fraudScore', 'duplicateOfPunchId', 'workDate', 'punchTimeSource', 'clientReportedTime'];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** @returns {{ equal: boolean, differences: object[], flagOrderMatches: boolean }} */
function compareOutcome(expected, actual) {
  const differences = [];
  for (const field of EXACT_FIELDS) {
    const e = expected[field] ?? null;
    const a = actual[field] ?? null;
    if (e !== a) differences.push({ field, expected: e, actual: a });
  }

  const ed = expected.distanceFromLocationMeters ?? null;
  const ad = actual.distanceFromLocationMeters ?? null;
  if ((ed === null) !== (ad === null) || (ed !== null && Math.abs(ed - ad) > DISTANCE_TOLERANCE_METERS)) {
    differences.push({ field: 'distanceFromLocationMeters', expected: ed, actual: ad });
  }

  const ef = (expected.fraudFlags ?? []).map(canonical);
  const af = (actual.fraudFlags ?? []).map(canonical);
  const sortedE = [...ef].sort();
  const sortedA = [...af].sort();
  if (sortedE.length !== sortedA.length || sortedE.some((f, i) => f !== sortedA[i])) {
    differences.push({ field: 'fraudFlags', expected: ef, actual: af });
  }
  const flagOrderMatches = ef.length === af.length && ef.every((f, i) => f === af[i]);

  return { equal: differences.length === 0, differences, flagOrderMatches };
}

/**
 * Daily-summary outcomes (contract attendance-daily-summary-result/1): EVERY field must match
 * exactly — there is no floating-point field and therefore no tolerance at all.
 */
function compareSummaryOutcome(expected, actual) {
  const differences = [];
  const fields = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const field of fields) {
    if (canonical(expected[field]) !== canonical(actual[field])) {
      differences.push({ field, expected: expected[field] ?? null, actual: actual[field] ?? null });
    }
  }
  return { equal: differences.length === 0, differences, flagOrderMatches: true };
}

function compareResultSets(left, right, leftName, rightName, compare = compareOutcome) {
  const ids = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const rows = ids.map((id) => {
    if (!(id in left) || !(id in right)) {
      return { id, equal: false, flagOrderMatches: false, differences: [{ field: 'presence', [leftName]: id in left, [rightName]: id in right }] };
    }
    return { id, ...compare(left[id], right[id]) };
  });
  return {
    compared: rows.length,
    equal: rows.filter((r) => r.equal).length,
    mismatches: rows.filter((r) => !r.equal),
    flagOrderDifferences: rows.filter((r) => r.equal && !r.flagOrderMatches).map((r) => r.id),
  };
}

module.exports = { canonical, compareOutcome, compareSummaryOutcome, compareResultSets, DISTANCE_TOLERANCE_METERS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const summaryMode = args.includes('--summary');
  const [nestPath, rustPath, reportPath] = args.filter((a) => a !== '--summary');
  if (!nestPath || !rustPath) {
    console.error('usage: node parity-compare.cjs [--summary] <nest-results.json> <rust-results.json> [report-out.json]');
    process.exit(2);
  }
  const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8')).outcomes;
  const compare = summaryMode ? compareSummaryOutcome : compareOutcome;
  const report = {
    contract: summaryMode ? 'attendance-daily-summary-result/1' : 'attendance-validation-result/1',
    ...compareResultSets(read(nestPath), read(rustPath), 'nest', 'rust', compare),
    distanceToleranceMeters: summaryMode ? null : DISTANCE_TOLERANCE_METERS,
  };
  if (reportPath) fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`NestJS vs Rust: ${report.equal}/${report.compared} scenarios identical; mismatches=${report.mismatches.length}; flag-order differences=${report.flagOrderDifferences.length}`);
  for (const m of report.mismatches) console.log(`  MISMATCH ${m.id}: ${JSON.stringify(m.differences)}`);
  process.exit(report.mismatches.length === 0 && report.flagOrderDifferences.length === 0 ? 0 : 1);
}
