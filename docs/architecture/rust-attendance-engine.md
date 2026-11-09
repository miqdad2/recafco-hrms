# Rust Attendance Engine — Architecture, Requirements Audit, and Integration Contract

| | |
| --- | --- |
| Unit | RUST-01 — High-Performance Architecture Audit and Rust Service Foundation |
| Date | 2026-11-08 |
| Status | Foundation service built and verified. **No live attendance processing is routed to Rust.** |
| Service | `apps/attendance-engine` (Rust, Axum/Tokio/SQLx), dev port `4100`, loopback-only |
| Authoritative writer of official attendance | **NestJS (`apps/api`) — unchanged** |
| Authoritative schema | **Prisma (`packages/db/prisma/schema.prisma`) — unchanged** |

This document is for engineers and AI agents working on RECAFCO HRMS. Section 3 also has
questions for RECAFCO HR. No item in it is a business rule until HR confirms it.

---

## 1. Why Rust, and why incrementally

The NestJS API already contains a working, verified attendance pipeline (Units 7–10, 20, 20.1).
Rust is introduced for the parts that will eventually be CPU-bound, burst-heavy or correctness-critical:

- deterministic re-evaluation of many employee-days (monthly close, policy changes, backfills)
- bursty device-sync ingestion
- a single, pure, exhaustively testable rules core

The adoption path is strangler-style:

1. **RUST-01 (this unit):** isolated service with health/readiness, a read-only DB pool, and the contracts.
2. **RUST-02:** port the *current* rules as pure Rust functions and prove they produce the same results (parity).
3. **Shadow mode:** Rust computes and NestJS compares. Rust writes nothing.
4. **Cutover:** official-summary ownership moves to Rust behind one switch, and only after shadow diffs reach zero.
   NestJS and Rust must never both write official summaries for the same employee/date.

A Rust rewrite of the NestJS backend is explicitly **not** planned.

---

## 2. Architecture audit (as-is, verified against the code on 2026-11-08)

### 2.1 Monorepo layout (verified)

| Path | Contents | Notes |
| --- | --- | --- |
| `apps/web` | Next.js 16 (App Router) | HR/admin + employee ESS screens |
| `apps/api` | NestJS 11 | Sole business-logic and write owner |
| `apps/mobile` | Expo / React Native (Expo Router) | Employee app |
| `packages/db` | Prisma 6.19.3 schema, 9 applied migrations, CJS client build | Schema authority |
| `packages/shared` | Shared enums/permissions/types | |
| `packages/config` | Shared TS/ESLint config | |
| `apps/attendance-engine` | **New** Rust service | Not a pnpm workspace package (no `package.json`), so `pnpm build`/turbo ignore it |

### 2.2 Attendance pipeline — exact code locations

| Concern | Location | What it does today |
| --- | --- | --- |
| Mobile raw punch creation | `apps/api/src/attendance-punches/attendance-punches.service.ts` → `AttendancePunchesService.createMobile` | Resolves employee from the JWT user. Stores `punchTimeSource` **from the client body** and `punchTimeServer = new Date()`. Attaches `mobileDeviceId` if the identifier exists, stores client fraud signals as a `CLIENT_REPORTED_SIGNALS` flag, writes the audit row, then calls `processNewPunch`. |
| Device import | same file → `createDeviceImport`; route `POST /attendance-punches/device-import` | Single-record JSON import by `employeeCode` and `attendanceDeviceId`. Idempotent via `@@unique([attendanceDeviceId, sourceId])` and a pre-check (returns the existing row, never a 409). `sourceType` is derived from the device. |
| Manual punch | same file → `createManual` | Always resolves to `PENDING_MANAGER_APPROVAL` (or `REJECTED_POLICY_VIOLATION` if there's no reason). |
| Automated validation | `attendance-punches/attendance-validation.service.ts` → `AttendanceValidationService.processNewPunch`, `validatePunch`, `validatePending`, `computeValidationResult`, `validateMobilePunch`, `validateDevicePunch`, `validateManualPunch`, `resolveDuplicateOriginal`, `recalculateIfAccepted` | Synchronous, in the same request. Severity-ranked status, additive `fraudScore`, `fraudFlags` recomputed from scratch on each run. |
| GPS / geofence | `validateMobilePunch` + module-level `calculateDistanceMeters` (haversine) | Per-punch, independent: geofence radius from `WorkLocation.geofenceRadiusMeters`. Accuracy > `MOBILE_GPS_ACCURACY_MAX_METERS` (100) → `PENDING_HR_REVIEW`. Mock/root/jailbreak client signal → `REJECTED_FAKE_GPS`. Falls back to the employee's default work location when the punch has none. |
| Constants | `attendance-punches/attendance-validation.constants.ts` | `MOBILE_GPS_ACCURACY_MAX_METERS = 100`, `DUPLICATE_WINDOW_MINUTES = 2` |
| Daily summary calculator | `attendance-summaries/attendance-summary-calculator.service.ts` → `AttendanceSummaryCalculatorService.calculateForEmployeeDate` (the single write path), `recalculateRange`, `chooseOfficialInOut`, `findActiveShift`, `calculateMinutes`, `determineStatus`, `updateOfficialFlags`, `upsertDailySummary` | Earliest accepted IN and latest accepted OUT within the Kuwait calendar day of `punchTimeSource`. Upserts `attendance_daily_summaries` and flips `isOfficial` inside one Prisma transaction. |
| Date handling | `attendance-summaries/kuwait-date.util.ts` → `toKuwaitWorkDate`, `kuwaitWorkDateRange`, `parseWorkDateInput`, `addShiftMinutesToWorkDate` | Fixed UTC+3 offset |
| Shift models | `schema.prisma` → `Shift` (`startTimeMinutes`, `endTimeMinutes`, `isOvernight`, `gracePeriodMinutes`, `breakMinutes`), `ShiftAssignment` (`effectiveFrom`/`effectiveTo`) | **No Shift API module exists** — "Implement shift service/API layer" is still in Next Up |
| Corrections | `attendance-corrections/attendance-corrections.service.ts` → `requestForSelf`, `approveCorrection`, `rejectCorrection` | Approval creates a `MANUAL_CORRECTION` punch at `ACCEPTED_WITH_WARNING` (transaction), then recalculates through the shared calculator. The raw punch being corrected is never edited. |
| Payroll lock | `payroll-locks/payroll-locks.service.ts` → `lockPeriod`, unlock; `payroll-locks/payroll-lock-guard.service.ts` → `PayrollLockGuardService.findActiveLockForDate`, `isDateInLockedPeriod`, `assertWorkDateNotLocked`, `assertDateRangeNotOverlappingActiveLock` | Global (company-wide) period lock. Locking stamps `lockedAt` on the summaries in range. Recalculation and correction approval are blocked for locked dates. Accepted punches arriving for a locked date get a `LOCKED_PERIOD_LATE_PUNCH` flag. |
| Monthly calculation status | — | **Does not exist.** Unit 20.2 (Monthly Attendance Payroll Basis Calculator) is the next planned NestJS unit. |
| Auth / RBAC | `auth/*` — `JwtAuthGuard`, `PermissionsGuard` (all-of permission check), `@Permissions(...)`, JWT payload embeds roles and permissions, refresh tokens hashed (SHA-256) in DB, argon2 password hashing | Guards are applied per controller with `@UseGuards` (no global `APP_GUARD`) |
| Audit | `audit/audit.service.ts` → `AuditService.record` | Before/after JSON snapshots. Recorded as separate writes after the data change (not in the same transaction). |
| Health | `health/health.controller.ts` → `GET /health`, `GET /health/db` | |

### 2.3 Test coverage (verified)

- At RUST-01 time there were no automated tests in the TypeScript codebase. `apps/api` lint is still a placeholder.
- **Update (TIME-01 / INCIDENT-02):** `apps/api` now has a Jest harness against an isolated, role-restricted `recafco_hrms_test` database, with 50 integration tests:
  - `test/attendance/mobile-punch-legacy.spec.ts`
  - `mobile-punch-time01.spec.ts`
  - `concurrency-payroll-lock.spec.ts`
  - `test/safety/database-isolation.spec.ts`

  These are the natural starting point for RUST-02's shared golden vectors.

### 2.4 Findings that matter for payroll safety

The Rust engine must not silently copy these gaps. They are recorded here and not fixed in RUST-01 (out of scope: "do not modify existing attendance behavior").

| # | Finding | Evidence | Risk |
| --- | --- | --- | --- |
| F1 | **FIXED in TIME-01** (server receipt time is official; the phone clock is diagnostic only; verified by tests). Original finding: **Official mobile time is the phone's clock.** The mobile app sends `punchTimeSource: new Date().toISOString()`, and the calculator, the workDate and duplicate detection all use `punchTimeSource`. `punchTimeServer` is stored but never used for calculation. There is no client/server skew check. | `apps/mobile/app/(app)/attendance.tsx:329`; `AttendanceSummaryCalculatorService.getEligiblePunches`/`chooseOfficialInOut`; `resolveDuplicateOriginal` | **High.** Changing the phone clock changes official IN/OUT. This contradicts `code-standards.md` ("Do not use local device time as official attendance time"). |
| F2 | `gracePeriodMinutes` is not applied to late minutes, and `breakMinutes` is not deducted from worked minutes. `BREAK_START`/`BREAK_END` punches are ignored. | `calculateMinutes` | Medium. Payroll-relevant once policies are active. |
| F3 | Overnight shifts are only partly handled. The shift end gets +24h, but punches are still grouped by the **calendar day** of the punch, so a 22:00–06:00 OUT lands on the next day's summary. | `getEligiblePunches` + `kuwaitWorkDateRange` | Medium/High for night-shift sites |
| F4 | **FIXED in TIME-01** (single transaction under a per-employee/day advisory lock; IN+OUT race tested over 24 rounds). Original finding: No serialization of concurrent recalculation for the same employee/day. `existing` and the eligible punches are read **outside** the transaction, there's no row or advisory lock, and `calculationVersion` can collide or regress. | `calculateForEmployeeDate` | Medium under burst load (mixed mobile + device sync for the same person) |
| F5 | **FIXED in TIME-01** (`FOR SHARE` re-check inside the write transaction plus `FOR UPDATE` first in `lockPeriod`; both interleavings tested deterministically). Original finding: The payroll-lock check and the summary write aren't atomic (TOCTOU). The check runs before the transaction, so a period can be locked between the check and the upsert. | `calculateForEmployeeDate`, `approveCorrection` | Low probability, high impact |
| F6 | **FIXED in TIME-01** for current APKs (`clientRequestId` unique per employee+source, fingerprint conflict → 409, replay returns the stored result; old APKs fall back to the duplicate window). Original finding: Mobile punches have no idempotency key. A network retry creates a second raw row, which is then marked `REJECTED_DUPLICATE` if within 2 minutes (by client time). Two identical requests with an identical `createdAt` would not see each other. | `createMobile`, `resolveDuplicateOriginal` (`createdAt: { lt }`) | Low/Medium |
| F7 | Validation, recalculation and audit all run inside the punch HTTP request (no queue). Audit rows are written outside the data transaction. | `processNewPunch` | Latency at peak, plus a small audit-gap window if the process crashes |
| F8 | Device identity is the **global `employeeCode`**. There is no per-device enrolment-ID mapping table. | `createDeviceImport` | Real biometric devices usually report a device-local user ID |
| F9 | Days with no punches never get a summary row, so absence isn't materialised. | Decision "recalculate-range never creates summaries for employee/days with zero raw punches" | Monthly aggregation (Unit 20.2) must handle absence explicitly |
| F10 | The timezone is a fixed UTC+3, and `WorkLocation.timezone` (default `"UTC"`) is ignored. | `kuwait-date.util.ts` | Fine for Kuwait-only operation; wrong for any non-Kuwait site |

---

## 3. Unified attendance business requirements

Status legend:
- **Implemented**: exists and is verified in code.
- **Partial**: exists with documented gaps.
- **Missing**: not built.
- **HR**: needs RECAFCO HR confirmation before anyone implements a rule.

The Pinnacle HRMS functional analysis document is **not in this repository**. The tracker only mentions Pinnacle screenshots used as a *UX* benchmark (Units 19.4/19.5). No Pinnacle business rules were assumed anywhere in this document.

| # | Requirement | Status | Evidence / gap | Awaiting RECAFCO HR confirmation |
| --- | --- | --- | --- | --- |
| 1 | Mobile IN + Mobile OUT | **Implemented** | Earliest accepted IN and latest accepted OUT, source-agnostic (`chooseOfficialInOut`) | — |
| 2 | Biometric IN + Biometric OUT | **Partial** | Selection works, but only through the single-record JSON `device-import` endpoint. No real device adapter/SDK and no batch sync yet. | Device brands/models and connection methods (open in tracker) |
| 3 | Mobile IN + Biometric OUT | **Implemented** (selection) | Same source-agnostic selection. Inherits F1 (mobile time is client time). | Whether either source has precedence when both exist for the same direction |
| 4 | Biometric IN + Mobile OUT | **Implemented** (selection) | As #3 | As #3 |
| 5 | Strict independent GPS validation per mobile punch | **Implemented** (TIME-01 also fixed the client's `mockLocationDetected` signal never being matched, which had let reported mock locations be auto-accepted) | Each punch is validated on its own (`validateMobilePunch`): geofence, accuracy, device binding, mock signal. The OUT is never trusted because of an accepted IN. | Radius per site, the accuracy threshold (currently 100 m), and whether poor accuracy should reject or go to review |
| 6 | Automatic validation of normal punches | **Implemented** | Unit 20.1: clean punches are auto-`ACCEPTED`, then the summary is recalculated in the same request | — |
| 7 | Duplicate and replay protection | **Implemented** (TIME-01: mobile `clientRequestId` idempotency + duplicate window + device `sourceId`). Was: **Partial** | Device: unique `(attendanceDeviceId, sourceId)`. Mobile: 2-minute same-type/same-source window by client time. No idempotency key (F6) and no request signing/nonce. | The duplicate window length |
| 8 | Employee/device identity mapping | **Partial** | Mobile: `MobileDevice.deviceIdentifier` → `employeeId`, approval status checked. Biometric: global `employeeCode` only (F8). | How device enrolment IDs map to employee codes on the real devices |
| 9 | Server-authoritative timestamps | **Implemented for online mobile** (TIME-01); biometric event time unchanged by design. Was: **Partial** | `punchTimeServer` is stored, but calculation uses client time (F1). | The allowed client/server skew, and the rule when it's exceeded (use server time / flag / review) |
| 10 | Biometric event time vs sync time | **Partial** | Event time → `punchTimeSource`, import time → `punchTimeServer`. Late sync into a locked period is flagged. No device clock-drift detection, and no maximum sync-delay rule. | The maximum acceptable sync delay, and how to treat drifted device clocks |
| 11 | Shift-aware daily calculation | **Partial** | Late/early/overtime computed from the active `ShiftAssignment`. No Shift API exists (assignments only via the database). | Shift types in use |
| 12 | Overnight shifts | **Partial** | F3 | How the attendance date is set for overnight shifts (start date vs end date) |
| 13 | Configurable breaks and grace periods | **Partial** (stored, not applied) | F2 | Grace rules, whether breaks are punched or auto-deducted, and whether grace "forgives" lateness or only delays the flag |
| 14 | Missing punch detection | **Partial** | `MISSING_PUNCH` when only IN or only OUT exists. No-punch days aren't materialised (F9). No "auto-close" of open shifts. | Absence vs missing-punch rules, weekend/holiday calendars |
| 15 | Payroll-lock protection | **Implemented** (with F5) | Period lock, `lockedAt`, blocked recalculation/approval, late-punch flag | Company-wide vs per-site close (open question) |
| 16 | Monthly attendance aggregation | **Missing** | Unit 20.2 planned | Payroll export format; how absence/late/overtime roll up |
| 17 | HR exception review | **Partial** | Pending statuses, `fraudFlags`, `validate`/`validate-pending` endpoints, Unit 14 web screens. No dedicated exception queue or assignment. | Who reviews what (manager vs HR), SLAs |
| 18 | Auditability and correction history | **Implemented** (with F7) | `AuditLog` with before/after snapshots on every mutation. Corrections keep the original raw punch and add a new `MANUAL_CORRECTION` punch. | Retention period for raw punches and audit logs |

### Intended unified rules (target behaviour; these become binding only once confirmed)

1. Every punch attempt is stored as an immutable raw event before any decision, from every source. *(Already true.)*
2. Each punch is validated **independently**, so its acceptance never depends on the other punch of the pair. Mobile punches pass device binding, geofence, accuracy and integrity checks. Device punches pass device-registration and active-location checks.
3. The **official time** of a mobile punch is server-authoritative: `punchTimeServer`, with the client time kept as evidence and the skew flagged. Biometric punches use the device event time, as long as the device clock is within an allowed drift window. *(HR/IT confirmation required: F1, #9, #10.)*
4. Official IN = the earliest accepted IN and official OUT = the latest accepted OUT **within the employee's shift window** (not the calendar day), regardless of source. This covers mixed sources and overnight shifts. *(HR: #12.)*
5. Duplicates (same employee/direction within the window, or the same device record ID) are stored as `REJECTED_DUPLICATE` and never become official.
6. Minutes are computed from the shift after applying the versioned grace and break policy. The result records the policy version used (determinism invariant #13/#14).
7. A day with an IN and no OUT (or vice versa) after the shift window closes is `MISSING_PUNCH`. A scheduled working day with no accepted punches is materialised as `ABSENT` at period close.
8. A summary inside a LOCKED period is never changed. A late punch for that period is stored and flagged for the post-lock correction workflow.
9. A correction never edits a raw punch. It adds a correction event and a new punch, and the change goes through the same calculator with a full audit.

---

## 4. Rust service (RUST-01 deliverable)

### 4.1 Toolchain (as installed on the dev machine)

| Item | Value |
| --- | --- |
| OS | Windows 11 Pro 10.0.26200 |
| rustc / cargo | 1.99.1 / 1.99.1 (stable, pinned in `rust-toolchain.toml`) |
| rustup | 1.29.3 |
| Host | `x86_64-pc-windows-gnu` (no Visual Studio Build Tools on this machine) |
| Install method | Official `rustup-init.exe`, SHA-256 verified against `static.rust-lang.org`, `--no-modify-path --profile minimal` |
| Extra component | `llvm-tools` (provides `llvm-dlltool` behaviour; see `scripts/cargo.sh`) |
| PostgreSQL | 18.4 (Windows service `postgresql-x64-18`, port 5432) |

### 4.2 Dependencies (resolved and locked in `Cargo.lock`)

axum 0.8.9 · tokio 1.54.1 · sqlx 0.9.0 (`runtime-tokio`, `postgres`, no TLS, no macros) · tower-http 0.7.1 (`trace`, `timeout`, `catch-panic`) · serde 1.0.229 · serde_json 1.0.154 · tracing 0.1.44 · tracing-subscriber 0.3.23 (`json`, `env-filter`) · thiserror 2.0.21 · dotenvy 0.15.7. Dev-only: tower 0.5.3, http-body-util 0.1.5.

### 4.3 Structure

```text
apps/attendance-engine/
├── Cargo.toml / Cargo.lock / rust-toolchain.toml
├── .env.example               # development template
├── .env.production.example    # production template (not deployed)
├── README.md
├── scripts/cargo.sh, cargo.ps1  # cargo wrapper (Windows-GNU dlltool shim; pass-through elsewhere)
├── src/
│   ├── main.rs        # config → telemetry → pool → bind → serve → close pool; exit codes 0/1/2
│   ├── lib.rs         # app(), serve() with graceful-shutdown + grace deadline, shutdown_signal()
│   ├── config.rs      # env parsing via injectable lookup; Secret redaction; range validation
│   ├── db.rs          # lazy PgPool, session-level read-only guard, statement_timeout
│   ├── error.rs       # JSON error envelope, 404 fallback, panic → 500 without details
│   ├── state.rs       # AppState { config, db: Option<PgPool> }
│   ├── telemetry.rs   # JSON (default) or pretty logs, RUST_LOG filter
│   ├── routes/{mod.rs, health.rs}
│   └── domain/mod.rs  # intentionally empty until RUST-02
└── tests/
    ├── common/mod.rs
    ├── health_test.rs         # /health, /ready (not configured, refused, timeout), 404, no write routes
    ├── lifecycle_test.rs      # graceful shutdown, in-flight drain, forced exit, binary exit codes, port conflict
    └── readiness_db_test.rs   # #[ignore] live-DB tests: ready=200 + read_only, DDL rejected (25006)
```

### 4.4 Behaviour

- `GET /health`: liveness only, never touches dependencies. Returns `200 {"service":"recafco-attendance-engine","status":"ok","version":"0.1.0"}`.
- `GET /ready`: runs `SHOW default_transaction_read_only` on a real pooled connection, bounded by `ATTENDANCE_ENGINE_READINESS_TIMEOUT_MS`.
  - Returns `200` only when the database answered **and** the session is read-only.
  - Otherwise returns `503` with `checks.database.status` set to one of `not_configured`, `unreachable`, `timeout` or `not_read_only`.
  - Driver errors and credentials are logged, never returned.
- Unknown routes return a JSON `404`. A handler panic returns a JSON `500` with no details. Every request is capped by a request timeout (returns `503`).
- Graceful shutdown happens on Ctrl+C (all platforms) or SIGTERM (Unix).
  - The listener closes and in-flight requests drain.
  - After `ATTENDANCE_ENGINE_SHUTDOWN_GRACE_MS` the process exits anyway.
  - The pool is closed before exit.
- Exit codes: `2` for invalid/missing configuration, `1` for runtime failure (e.g. port in use), `0` for a clean stop.
- Production refuses to start without `ATTENDANCE_ENGINE_DATABASE_URL`. Development starts without it, and `/ready` honestly reports `503 not_configured`.

---

## 5. Database ownership rules

| Rule | Mechanism |
| --- | --- |
| Prisma (`packages/db`) is the only schema authority | Rust has no migrations directory and does not enable sqlx `migrate`. Any table Rust needs later is added through a reviewed **Prisma** migration first. |
| Rust is read-only in RUST-01 | (1) Every session starts with `default_transaction_read_only=on` (set in `db.rs`). (2) `/ready` verifies this on a live connection and fails closed. (3) A dedicated read-only role is recommended (README). Verified live: `CREATE TABLE` was rejected with SQLSTATE `25006`. |
| Rust never reads the NestJS secrets | Only `apps/attendance-engine/.env` is loaded (an exact path, with no parent-directory search). All variables use the `ATTENDANCE_ENGINE_` prefix. |
| Bounded resource use | Pool max 5 (dev) / 10 (prod template), `statement_timeout` 5 s, acquire timeout 3 s. Combined with the API's Prisma pool, this must stay under PostgreSQL `max_connections`. |

### How future Rust SQL stays compatible with Prisma migrations

1. Tables and columns are referenced by their **physical** names, which Prisma maps:
   - tables use `@@map` names (`attendance_raw_punches`);
   - columns keep Prisma's camelCase field names and must be double-quoted (`"employeeId"`, `"punchTimeSource"`), because no `@map` is used on columns.
   - Enums are PostgreSQL enum types named after the Prisma enum (`"PunchValidationStatus"`). Rust decodes them as text or as `#[derive(sqlx::Type)]` enums with matching variant names.
2. Every Rust query lives in one module per table, with an explicit column list (never `SELECT *`), so a schema change has one place to update.
3. Before compile-time-checked queries (`sqlx::query!`) are adopted, enable the sqlx `macros` feature and commit `.sqlx/` offline metadata (`cargo sqlx prepare`), so builds don't need a live database. CI should run `cargo sqlx prepare --check` against a database migrated with `prisma migrate deploy`. That makes a Prisma migration that breaks a Rust query fail CI.
4. A Prisma migration that renames or drops a column Rust uses must follow expand/contract: add, dual-read, migrate, remove. That gets a checklist item in the PR template once Rust has real queries.
5. Rust never runs `prisma migrate`, never runs sqlx migrations against HRMS tables, and never changes constraints.

---

## 6. NestJS ↔ Rust integration contract (design only; nothing is wired in RUST-01)

### 6.1 Ownership phases

| Phase | Who computes official summaries | Who writes them | Rust DB access |
| --- | --- | --- | --- |
| 0 — now (RUST-01) | NestJS | NestJS | read-only, unused |
| 1 — parity (RUST-02) | NestJS (official) + Rust (offline, test vectors) | NestJS | read-only |
| 2 — shadow | NestJS (official) + Rust (shadow, on the same inputs) | NestJS writes the summary; Rust results stored only as diff records (new Prisma-owned table) | read-only |
| 3 — cutover | Rust | **Rust only**, behind a single ownership switch. The NestJS calculator becomes a thin client. | write role scoped to summary/official-flag/audit/job tables |

**Invariant:** at any moment exactly one component may write `attendance_daily_summaries` and `attendance_raw_punches."isOfficial"`.
- The phase-3 switch is a row in a Prisma-owned settings table, read **inside** the writing transaction.
- Both writers also take `pg_advisory_xact_lock(hashtextextended('att-day:' || employeeId || ':' || workDate, 0))`.
- So even a misconfigured deployment serialises on the same lock, and the loser sees "not owner" and aborts.

### 6.2 Transport choice

- **Synchronous internal HTTP** (`/v1/...`) for pure evaluation: NestJS sends a self-contained input snapshot and Rust returns a deterministic result. This is used in phases 1–2. It's stateless and easy to compare.
- **Durable PostgreSQL job table** for recalculation in phase 3. The punch request stays fast: save the raw punch plus enqueue in one transaction.

PostgreSQL is enough as the queue at RECAFCO's scale (§8), so **Redis/BullMQ is not required for this path**. Adding it would put a second source of state in front of payroll-critical work.

### 6.3 Authentication between services

- The Rust engine binds to loopback or a private Docker network only, and is never exposed through Nginx.
- Every `/v1` request carries `Authorization: Bearer <ATTENDANCE_ENGINE_INTERNAL_TOKEN>`, a ≥32-byte random value from the secret store, compared in constant time. There's a separate token per caller, rotatable with two accepted values during rotation.
- mTLS can replace the token if the services ever run on different hosts.
- Rust authenticates the **calling service**, not end users. RBAC stays in NestJS. Rust never accepts end-user JWTs.

### 6.4 Audit identity propagation

These headers are required on every `/v1` call and are echoed into every audit row Rust writes in phase 3:

| Header | Example | Meaning |
| --- | --- | --- |
| `X-Request-Id` | UUID | Correlates the API log, the Rust log and the audit rows |
| `X-Actor-Type` | `USER` \| `SYSTEM` | `SYSTEM` = automated engine decision (matches the existing `actorUserId: null` convention) |
| `X-Actor-User-Id` | cuid or empty | The human who triggered it, if any |
| `X-Origin` | `mobile-punch` \| `device-import` \| `correction-approval` \| `admin-recalc` \| `period-close` | Why the evaluation happened |

### 6.5 Request/response schemas (v1, draft)

`POST /v1/evaluations/daily-summary` is a pure function: it uses no database, and the same input always gives the same output.

```json
{
  "requestId": "4b1c6f0e-…",
  "rulesetVersion": "nest-parity-2026-11",
  "employee": { "id": "cm…", "status": "ACTIVE" },
  "workDate": "2026-11-08",
  "timezone": "Asia/Kuwait",
  "shift": { "startTimeMinutes": 420, "endTimeMinutes": 900, "isOvernight": false, "gracePeriodMinutes": 0, "breakMinutes": 0 },
  "punches": [
    { "id": "cm…", "punchType": "IN", "sourceType": "MOBILE", "validationStatus": "ACCEPTED",
      "punchTimeSource": "2026-11-08T04:01:12Z", "punchTimeServer": "2026-11-08T04:01:13Z" }
  ],
  "payrollLocked": false
}
```

```json
{
  "requestId": "4b1c6f0e-…",
  "engineVersion": "0.2.0",
  "rulesetVersion": "nest-parity-2026-11",
  "result": {
    "officialInPunchId": "cm…", "officialOutPunchId": "cm…",
    "officialInTime": "2026-11-08T04:01:12Z", "officialOutTime": "2026-11-08T12:03:40Z",
    "totalWorkedMinutes": 482, "lateMinutes": 1, "earlyLeaveMinutes": 0, "overtimeMinutes": 4,
    "status": "LATE"
  },
  "inputDigest": "sha256:…"
}
```

`inputDigest` is a hash of the canonicalised input. Shadow diffs compare `(inputDigest, result)` pairs. A digest mismatch means the two sides saw different data; it isn't a rules bug.

`POST /v1/evaluations/punch-validation` follows the same shape. It takes a raw punch plus the employee/device/location facts it needs, and returns `{ validationStatus, fraudScore, fraudFlags, distanceFromLocationMeters, duplicateOfPunchId }`.

Errors use one shape: `{"error":{"code":"VALIDATION_FAILED","message":"…","retryable":false}}`.

| HTTP | code | retryable |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED`, `UNSUPPORTED_RULESET` | no |
| 401 | `UNAUTHENTICATED` | no |
| 409 | `PAYROLL_LOCKED`, `NOT_OWNER` (phase 3) | no |
| 503 | `UNAVAILABLE`, `DATABASE_UNAVAILABLE` | yes |
| 504 | `TIMEOUT` | yes |

### 6.6 Timeouts, retries, idempotency, versioning

- **Timeouts.** NestJS → Rust evaluation: 2 s client timeout (Rust's own request timeout is 10 s as a backstop). Phase-3 job claim lease: 60 s.
- **The punch path never waits on Rust.** Phase 2 shadow calls are fire-and-forget after the NestJS response. Phase 3 enqueues in the punch transaction.
- **Retries.** Only on `retryable: true` or a network error/timeout. At most 3 attempts with exponential backoff and jitter (200 ms, 800 ms, 3.2 s). No retries on 4xx.
- **Idempotency.**
  - Evaluation endpoints are pure, so they are naturally idempotent.
  - Phase-3 job processing is idempotent because a job is "recalculate employee X / day D from the current facts". Running it twice yields the same summary.
  - Mobile punch intake should gain an `Idempotency-Key` (a UUID generated per tap by the app). A future Prisma migration would add a unique `(employeeId, idempotencyKey)` index, closing F6.
- **Versioning.**
  - The URL major version (`/v1`) is for breaking changes. Additive fields are allowed within v1.
  - `rulesetVersion` names the business-rule set, so it changes whenever a policy changes. Rust rejects unknown versions with `UNSUPPORTED_RULESET` instead of guessing.
  - `engineVersion` is the Cargo package version.
  - The summary's existing `calculationVersion` stays a per-row revision counter.

### 6.7 Transaction boundaries (phase 3)

One transaction per (employee, workDate) job:

1. `SELECT pg_advisory_xact_lock(<employee/day key>)`.
2. Check the ownership switch → if Rust isn't the owner, roll back with `NOT_OWNER`.
3. Check the payroll lock for the workDate **inside the same transaction**, which closes F5. If locked: flag the punches and mark the job `SKIPPED_LOCKED`.
4. Read the eligible punches, active shift and policy version (the same snapshot as the evaluation input).
5. Compute (pure function), upsert the summary, update the `isOfficial` flags, and insert the audit row **in the same transaction**, which closes the F7 audit gap.
6. Mark the job `DONE` and commit.

Validation status writes on raw punches remain limited to the controlled metadata columns that NestJS writes today (`validationStatus`, `fraudScore`, `fraudFlags`, `validatedAt`, `validatedByUserId`, `isOfficial`, `duplicateOfPunchId`, `distanceFromLocationMeters`). Raw evidence columns are never updated.

---

## 7. Reliability design

| Scenario | Design |
| --- | --- |
| 1,000–2,000 simultaneous punch attempts | The request path is minimal: authenticate, validate the DTO, insert the raw punch, and enqueue the recalculation job (`INSERT … ON CONFLICT ("employeeId","workDate") WHERE status='PENDING' DO NOTHING` coalesces bursts per person/day), then commit and respond. Validation and recalculation move off the request path (phase 3). The pools are sized so the API pool plus the engine pool stay below `max_connections`, with headroom for admin and backup tooling. |
| Mobile network interruption | The client retries with the same `Idempotency-Key`, and the server returns the original punch. Offline queuing remains disallowed until policy approves it (code-standards). The server time is recorded at receipt, so a delayed retry is visible as skew. |
| Biometric database delays | Device sync is pull-based with a per-device high-water mark (last `sourceId`/event time). A delayed batch is simply processed later. Event time is preserved and sync time is recorded. Imports after the period lock are flagged, never silently applied. |
| Duplicate device sync | The unique `(attendanceDeviceId, sourceId)` constraint plus `ON CONFLICT DO NOTHING`. Re-syncing an entire device is safe. |
| Worker crash mid-processing | The job is claimed with `FOR UPDATE SKIP LOCKED` and gets a lease (`lease_until`). The computation commits atomically or not at all. An expired lease makes the job reclaimable, and recomputation from facts is idempotent. `attempts` is capped, and a job past the cap moves to `FAILED` for HR/IT review with an alert. |
| PostgreSQL restart | The engine starts and stays up without the database (lazy pool), and `/ready` returns 503 until it's back. `test_before_acquire` discards dead connections. In-flight jobs roll back and are reclaimed after the lease expires. Punch intake (NestJS) returns 503 during the outage. Nothing is half-written, because each unit is one transaction. |
| Out-of-order IN/OUT | Selection is by time within the shift window, not by arrival order. Every arrival re-enqueues the employee-day, and the final state depends only on the full set of facts (determinism invariant). |
| Concurrent updates to one employee/day | The advisory transaction lock per employee/day serialises writers. Job coalescing keeps one pending job per employee/day. `calculationVersion` is incremented under the lock. |
| Missing punches | Detected at shift-window close (a scheduled sweep job), not at the moment of punching. Absence is materialised at period close for scheduled days without punches (F9; HR rules required). |
| Locked payroll periods | The check happens inside the writing transaction. Locked days are never modified, and late facts are stored and flagged for the post-lock correction workflow. |
| Recovery after unexpected server restart | All state is in PostgreSQL. Pending, expired-lease and failed jobs are visible in one table. Startup runs no destructive recovery: workers simply resume claiming. A reconciliation job can recompute any employee-day range read-only and report diffs before anything is rewritten. |

Infrastructure decision: **no Redis or BullMQ for the attendance path.**
- Expected peak load: about 2,000 employees punching in roughly a 15-minute window, which is about 2–3 punches/s on average with bursts perhaps up to 50/s.
- That is well within a PostgreSQL `SKIP LOCKED` queue.
- Revisit only if measured load tests (§8) show the database queue is a bottleneck.

---

## 8. Performance baseline plan (future; no production load testing)

**Environment.**
- A staging PostgreSQL restored from a sanitised dev dump, plus synthetic employees, devices, work locations and shift assignments (2,000 employees).
- Never production.
- Run on hardware comparable to the target internal server, and record its spec with each result.

**Tool.** k6 (open source, free) for the HTTP scenarios, plus a small Rust or k6 script for the device-sync batches. Test JWTs are minted for synthetic users only.

**Scenarios.** Ramp to N virtual users, each submitting one IN (and later one OUT) within a 60-second window, for N = **100, 500, 1,000, 2,000**. Each scenario runs:
- (a) all mobile;
- (b) all device-import;
- (c) a 50/50 mix, including the same employee punching on both sources;
- (d) mobile with 10% forced client retries (same idempotency key).

**Measure.**

| Metric | Source |
| --- | --- |
| API response latency p50/p95/p99 | k6 |
| Punch processing time (receipt → summary updated) | `punchTimeServer` vs the summary's `calculatedAt`, from SQL |
| DB connection usage | `pg_stat_activity` grouped by `application_name` (the engine sets `recafco-attendance-engine`) |
| Memory and CPU per process | OS counters (the engine idles at about 11 MB RSS today) |
| Error rate by status code | k6 |
| Throughput (punches/s accepted) | k6 + SQL count |
| Queue delay (if the job table is introduced) | job `created_at` → `started_at` → `finished_at` |
| **Correctness of finalized attendance** | After each run, recompute every touched employee-day with an independent read-only pass and diff against the stored summaries. **Must be zero diffs, zero lost raw punches, zero duplicate official punches.** |

**Proposed pass criteria (to be confirmed with management):**
- at 2,000 VUs, punch p95 < 500 ms and p99 < 1.5 s;
- error rate < 0.1% (excluding intentional rejections);
- all punches stored;
- correctness diff = 0;
- no connection-pool exhaustion.

---

## 9. Risks and open questions

**Risks.**
1. **F1 (client clock as official mobile time)** is the most serious payroll risk found. It needs an HR/IT decision and a NestJS change, separate from Rust work.
2. Parity without tests: the TypeScript side has no automated tests, so RUST-02 must first capture current behaviour as golden vectors. Otherwise "parity" can't be proven.
3. Bugs could be ported faithfully. RUST-02 parity will deliberately reproduce F2/F3 behaviour. Fixing them is a separate, HR-approved, versioned ruleset change applied to both implementations (or to Rust only after cutover).
4. The Windows-GNU dev toolchain differs from the expected Linux production build. Production builds should happen in a Linux container (`rust:1.99-slim` → distroless/debian-slim runtime) in a later deployment unit.
5. Two languages implementing the same rules is a temporary duplication cost until cutover, which is why there's a single ownership switch and a time-boxed shadow phase.
6. During this audit, ports 3000 and 4000 on the dev machine were served by a **different project** (`C:\Users\5857\Desktop\recafco-fmp`). The recafco-hrms API's `nest start --watch` was running without a listening child. Port allocation for local development should be coordinated: the engine uses 4100.

**Open questions (also recorded in `context/progress-tracker.md`).**
- HR: every item in the "Awaiting RECAFCO HR confirmation" column of §3.
- IT: the maximum client/server skew for mobile punches, and the policy when it's exceeded.
- IT: the PostgreSQL `max_connections` on the production server, which sets the pool budget across API and engine.
- IT: whether a dedicated read-only role (`recafco_engine_ro`) may be created on dev/staging/prod.
- Management: approval of the §8 pass criteria.
- Whether the Pinnacle functional analysis document can be provided. If so, its rules are reviewed against §3, not adopted blindly.

---

## 10. RUST-02: Attendance Validation Engine Parity (planned scope — **completed 2026-11-08, see §11**)

**Goal.** Pure Rust implementations of today's NestJS rules, proven equivalent, with no live wiring and no writes.

**Post-TIME-01 parity target.** The rules to reproduce are the **current** ones:
- official mobile time = server receipt time (`punchTimeSource`);
- `(createdAt, id)` duplicate tie-break;
- the extended mock-signal key list;
- `INTAKE`-sourced flags preserved across re-validation;
- per-employee/day serialised recalculation.

The TypeScript test runner already exists (`apps/api`, Jest, isolated test DB), so scope item 3 below reduces to exporting vectors from the existing suites.

**Scope.**
1. Extract the deterministic parts of `AttendanceValidationService.computeValidationResult` and `AttendanceSummaryCalculatorService` (`chooseOfficialInOut`, `calculateMinutes`, `determineStatus`, Kuwait date helpers, haversine, severity ranking, fraud weights) into `apps/attendance-engine/src/domain/` as I/O-free functions over plain input structs.
2. Create shared golden test vectors as JSON fixtures under a neutral path (e.g. `packages/attendance-test-vectors/`). They cover every row of §3 that is currently implemented or partial, including mixed sources, duplicates, geofence edges, accuracy edges, locked periods, overnight, and missing punches.
3. Add a minimal TypeScript test runner to `apps/api` (Vitest or Jest) that runs the **existing** NestJS logic against the same vectors, without changing that logic. Then add Rust tests that run the same vectors. Both must pass identically.
4. Add a read-only shadow-diff CLI or endpoint that recomputes summaries for a dev-database date range and reports differences against the stored rows. It writes nothing.
5. **Not in scope:** fixing F1–F10, changing NestJS behaviour, writing to the database, or connecting live traffic.

**Exit criteria.**
- 100% of vectors pass in both TypeScript and Rust.
- The shadow-diff over the dev database shows zero unexplained differences.
- `cargo fmt/clippy/test/build --release` and `pnpm typecheck/lint/build` all pass.

**As delivered.**
- Summary-calculation parity (part of scope item 1) moved to RUST-03.
- The dev-database shadow-diff (scope item 4) wasn't run: dev holds no attendance rows after INCIDENT-01, so synthetic fixtures replace it.

---

## 11. RUST-02 results (2026-11-08)

### 11.1 Domain model (`apps/attendance-engine/src/domain/`)

| Module | Contents |
| --- | --- |
| `types.rs` | Enums mirroring Prisma value-for-value: `PunchType`, `AttendanceSourceType`, `PunchValidationStatus` (with the NestJS severity ranking and `is_accepted`), `EmployeeStatus`, `MobileDeviceStatus`. |
| `input.rs` | `ValidationInput`: every fact NestJS reads from the database, passed explicitly. Contains `PunchFacts` (official instant `punchTimeSource`), `EmployeeContext`, `WorkLocationContext`, `MobileDeviceContext`, `AttendanceDeviceContext`, `EarlierPunch` (duplicate candidates) and `lockedWorkDates`. |
| `geo.rs` | Haversine with identical operation order and Earth radius; `js_round`, which follows JavaScript `Math.round` semantics (halves toward +∞). |
| `fraud.rs` | Fraud weights, the engine-flag shape, preserved-flag filtering, and `hasFraudSignal` with the TIME-01 key list (strict boolean `true`). |
| `duplicate.rs` | `resolveDuplicateOriginal`: explicit-link short-circuit, ±2 min inclusive window, or the same non-empty `sourceId`, ordered by `(createdAt, id)`. |
| `time.rs` | `kuwait_work_date` (fixed UTC+3); `mobile_intake` (TIME-01: official = server receipt; diagnostic client time; `CLIENT_CLOCK_SKEW` > 300 s; `LEGACY_CLIENT_NO_REQUEST_ID`; `CLIENT_TIME_UNPARSEABLE`). |
| `validation.rs` | `validate()` (employee → duplicate → manual/mobile/device paths → most-severe status, accumulated score and flags → `LOCKED_PERIOD_LATE_PUNCH`) and `validate_mobile_intake()`. Defines `RESULT_CONTRACT_VERSION = attendance-validation-result/1` and `RULESET_VERSION = nest-post-time01-2026-11-08`. |

- Pure and deterministic: no I/O, no clock reads, no randomness. A test asserts that repeated calls give identical results.
- **Not wired** to any route, queue or database. NestJS remains the sole decision-maker and writer.

### 11.2 Current NestJS rules (reproduced exactly, not changed)

**Order of evaluation**
1. **Employee:** missing or not `ACTIVE` → `REJECTED_EMPLOYEE_INACTIVE` (100).
2. **Duplicate check:** a duplicate → `REJECTED_DUPLICATE` (80).
3. **Source path:**
   - `MANUAL_CORRECTION` → manual path.
   - `MOBILE` → mobile path.
   - **every other source** (BIOMETRIC, FACE, CARD, **WEB**, IMPORT, FUTURE) → physical-device path.
4. **Result:** the most severe candidate wins (ties keep the first); the score is the sum of all conditions; flags are the preserved non-engine flags first, then the engine flags in rule order.

**Mobile path** (stops at the first of 1–4)
1. `!isMobilePunchAllowed || isDeviceOnly` → `REJECTED_POLICY_VIOLATION` (50).
2. No device → `DEVICE_NOT_REGISTERED`.
3. Device missing or another employee's → `DEVICE_BELONGS_TO_DIFFERENT_EMPLOYEE_OR_MISSING`.
4. Device not `APPROVED` → `DEVICE_BLOCKED`, `DEVICE_DEACTIVATED` or `DEVICE_NOT_APPROVED`.
   - Cases 2–4 are all `REJECTED_UNREGISTERED_DEVICE` (80).

Then these conditions accumulate:
- **Work location:** the punch's own work location, else the employee default (with `WORK_LOCATION_INFERRED_FROM_EMPLOYEE_DEFAULT`). If missing or inactive → `WORK_LOCATION_INACTIVE`, `REJECTED_POLICY_VIOLATION` (+40).
- **Coordinates:**
  - No coordinates → `MISSING_LOCATION_DATA`, `PENDING_HR_REVIEW` (+20).
  - Otherwise distance > radius → `OUTSIDE_GEOFENCE`, `REJECTED_OUTSIDE_LOCATION` (+70).
  - Otherwise, if no location is resolvable → `WORK_LOCATION_NOT_ASSIGNED`, `PENDING_HR_REVIEW` (+0).
- **GPS accuracy:** > 100 m → `GPS_ACCURACY_POOR`, `PENDING_HR_REVIEW` (+30).
- **Mock or root signal:** → `FAKE_GPS_SIGNAL`, `REJECTED_FAKE_GPS` (+90).
- **Nothing raised** → `ACCEPTED`.

**Device path**
- No device id → `UNRECOGNIZED_SOURCE_NO_DEVICE`, `PENDING_HR_REVIEW` (0).
- Device inactive or missing → `REJECTED_UNREGISTERED_DEVICE` (80).
- Device's location inactive → `REJECTED_POLICY_VIOLATION` (40).
- Otherwise `ACCEPTED`. No GPS is required, and the device event time is the official time.

**Manual path**
- Non-blank `rawPayload.reason` → `PENDING_MANAGER_APPROVAL`. A manual punch is never auto-accepted; only correction approval makes one official.
- Otherwise `MISSING_REASON`, `REJECTED_POLICY_VIOLATION` (50).

**After validation:** an accepted punch whose Kuwait work date is locked gets `LOCKED_PERIOD_LATE_PUNCH`.

**Existing behaviours worth HR/IT review** (pinned by fixtures; **not changed**):
- **V22:** a string `"true"` is not a mock signal; only boolean `true` counts. The shipped app sends booleans.
- **V36:** a `WEB`-source punch goes through the device path and lands in `PENDING_HR_REVIEW`.
- **V42:** an earlier *rejected* punch still makes a later one a duplicate. A punch rejected for being outside the geofence blocks a valid retry within 2 minutes.
- **V44:** the same `sourceId` counts as a duplicate regardless of time or device.

### 11.3 Parity method and results

- **Fixtures:** `packages/attendance-test-vectors/` holds 67 synthetic scenarios. They cover all 20 required cases plus boundaries (accuracy 100 / 100.5, duplicate window 120 s / 121 s, skew 300 s / 301 s, `Math.round` −1800.5 s, Kuwait midnight both sides) and every branch above.
- **NestJS side:** `apps/api/test/parity/validation-parity.spec.ts` seeds each scenario into the guarded `recafco_hrms_test` and runs the **unmodified** `processNewPunch` or `createMobile` (with a fixed clock).
- **Expected outcomes:** recorded once, reviewed line by line against this section, and frozen.
- **Rust side:** `tests/parity_test.rs`.
- **Cross-check:** `parity-compare.cjs`.

| Check | Result |
| --- | --- |
| NestJS vs frozen expected | **67/67** |
| Rust vs frozen expected | **67/67** (on the first run; the engine was written before any NestJS outcome was recorded) |
| Direct NestJS ↔ Rust result files | **67/67 identical, 0 mismatches, 0 flag-order differences** |
| Max \|distance\| difference | 2.3e-13 m (tolerance 1e-6 m) |
| Comparator mutation tests | Status, flag-detail, 1 mm distance and flag-order corruptions are all detected (non-zero exit) |

**Mismatches found: none.** No NestJS behaviour was changed in RUST-02.

### 11.4 Representation limits (documented, not business differences)

- Rust parses client clock strings as strict RFC 3339. JavaScript `new Date()` also accepts other ISO forms, such as date-only strings. Both engines treat the value as diagnostic only, so it can never change official time or status. Only the `CLIENT_TIME_UNPARSEABLE` / skew flag could differ, for exotic formats. All fixtures use RFC 3339.
- Lower-casing of signal keys uses Unicode rules in both languages. Only ASCII keys exist in practice.
- The "employee row missing" case (`NOT_FOUND`) can't be seeded through NestJS because of the FK, so it's covered by a Rust-only test that matches the NestJS code path.

### 11.5 Performance baseline (pure function only)

**Setup**
- Machine: Intel i7-1165G7, 8 logical CPUs, Windows 11, a laptop with power management; another project's dev servers were running.
- Command: `cargo run --release --example validation_bench -- 2000000`, using the 67 fixture inputs round-robin.

| Metric | Run 1 | Run 2 |
| --- | --- | --- |
| Single-thread latency p50 / p90 / p99 / p99.9 | 2.0 / 4.5 / 8.8 / 19.1 µs | 1.3 / 2.9 / 5.2 / 14.5 µs |
| Single-thread throughput | 288k validations/s | 448k validations/s |
| 4-thread throughput | 1.05M validations/s | 0.48M validations/s |
| Process CPU time | — | 18.4 s over 9.1 s wall (≈ 25% of 8 CPUs, i.e. ~2 cores busy on average) |
| Peak working set | 8.1 MB | 7.7 MB |

- The run-to-run spread reflects laptop frequency scaling and background load. Treat it as an order of magnitude: **sub-10 µs p99, hundreds of thousands per second per core**.
- This measures only the decision function. It says nothing about end-to-end punch latency, which is dominated by HTTP, authentication and PostgreSQL round-trips. The §8 load-test plan still applies.

### 11.6 Database safety in RUST-02

- **Before any database-backed testing:** a verified dev backup (`recafco_hrms_dev-20261108T112213Z.dump`) and the isolation suite 18/18.
- **Where the NestJS parity spec ran:** only against the guarded `recafco_hrms_test`, with the explicit reset flag.
- **Dev untouched:** row counts were identical before and after the full 117-test run.
- **No migration, no dev write, and no read-only dev comparison:** the development database holds no attendance rows after INCIDENT-01, so synthetic fixtures were used instead.

### 11.7 Remaining limitations

- Parity covers **validation decisions** only. The daily-summary calculation, official IN/OUT selection and shift minutes are not yet ported; that is RUST-03.
- **No live traffic.** The engine has no `/v1` evaluation endpoint and no shadow mode yet.
- Recalculation locking, idempotency storage and the payroll-lock transaction are **database concerns**, and they stay in NestJS (TIME-01). Rust only models the lock flag's decision.

## 12. RUST-03: Shift-Aware Working Hours and Mixed-Source Attendance (planned scope — **completed 2026-11-08, see §13**)

- **Port to pure Rust**, with parity fixtures in the same package (`summary-v1.*`) and the same record → review → freeze method:
  - `AttendanceSummaryCalculatorService`'s official IN/OUT selection (earliest accepted IN, latest accepted OUT, source-agnostic, so mobile+biometric mixes are covered);
  - active shift resolution;
  - worked, late, early-leave and overtime minutes;
  - daily status (`PRESENT`/`LATE`/`MISSING_PUNCH`/`ABSENT`);
  - Kuwait day windows.
- **Reproduce current behaviour exactly,** including F2 (grace/break stored but unapplied) and F3 (overnight shifts grouped by calendar day). Any change to those needs HR approval and a new `rulesetVersion`.
- **Still out of scope:** no writes and no live wiring.

---

## 13. RUST-03 results (2026-11-08)

### 13.1 Daily-summary domain (`apps/attendance-engine/src/domain/`)

| Module | Mirrors (NestJS `AttendanceSummaryCalculatorService`) |
| --- | --- |
| `punch_pairing.rs` | `getEligiblePunches` + `chooseOfficialInOut`: eligible = `ACCEPTED`/`ACCEPTED_WITH_WARNING` within the Kuwait day `[start, end)`; earliest IN, latest OUT; source-agnostic. |
| `shift.rs` | `findActiveShift` (overlapping assignment, latest `effectiveFrom`, `isActive` ignored) and shift boundaries (`isOvernight` or end ≤ start → end + 24 h). |
| `working_time.rs` | `calculateMinutes`: `max(0, Math.round(Δms / 60000))` with JavaScript half-up rounding. Grace and break are **not** applied. |
| `summary_status.rs` | `determineStatus`: PRESENT / LATE / MISSING_PUNCH / ABSENT. |
| `summary.rs` | `calculateForEmployeeDate` as a pure function, in this order: <ol><li>locked-period refusal (checked first)</li><li>locked-summary refusal</li><li>official IN/OUT plus their **source types**, minutes, status</li><li>`calculationVersion = previous + 1`</li><li>the resulting `isOfficial` set (in-day flags reassigned, other days untouched)</li></ol>Contract `attendance-daily-summary-result/1`. |

- Inputs are explicit: employee id, work date, candidate punches (status, source, trusted instant, prior `isOfficial`), shift assignments, existing summary state, and period-lock state.
- There is no clock: `calculatedAt` is outside the contract.
- There is no database access.
- **Not a writer and not wired:** NestJS still computes and stores every summary.

### 13.2 Parity

- **Fixtures:** 48 synthetic scenarios (`packages/attendance-test-vectors/summary-v1.*`), covering all 28 required cases plus:
  - assignment edges (latest wins, ended, ending exactly at day start, starting exactly at day end);
  - an inactive shift;
  - an implicit overnight shift;
  - OUT before IN;
  - official-flag reassignment;
  - only-rejected days;
  - manual punches pending approval;
  - the Kuwait midnight edges on both sides.
- **Method:** the same as RUST-02. Recorded from the unmodified calculator in the guarded test DB, reviewed line by line, frozen.

| Check | Result |
| --- | --- |
| NestJS vs frozen expected | **48/48** |
| Rust vs frozen expected | **48/48** (first run) |
| Direct NestJS ↔ Rust | **48/48 identical, 0 mismatches.** Every field exact; no tolerance. |
| Input-order independence (no ties) | Verified for all 48 (reversed punches and assignments give an identical result) |
| Comparator mutation tests | ±1 late minute, swapped official OUT, changed status and a dropped official flag are all detected |

Mixed-source verification:
- S07 mobile IN + biometric OUT;
- S08 biometric IN + mobile OUT;
- S09 mobile + mobile;
- S10 biometric + biometric;
- S33 four-way mix, where the earliest IN (biometric) and the latest OUT (mobile) win;
- S16 manual `ACCEPTED_WITH_WARNING` IN + biometric OUT.

Each official punch keeps its own source type.

### 13.3 Current calculation defects (reproduced, **not corrected**)

The defects D1–D11 are listed in `docs/architecture/shift-payroll-rules.md` §1, each with its fixture:
- D1 grace not applied;
- D2 break not deducted;
- D3 30 s late → LATE;
- D4 overnight split across two days;
- D5 OUT-before-IN → PRESENT;
- D6 inactive shift still applies;
- D7/D8 tie ordering undefined;
- D9 no absence, weekend or holiday awareness;
- D10 overtime without approval;
- D11 no late minutes without an OUT.

The future rule design and every HR decision point are in the same document. The display contract for running timers is in `docs/architecture/live-attendance-timer-contract.md`.

### 13.4 Benchmark (pure summary function only)

`cargo run --release --example summary_bench` on an Intel i7-1165G7 laptop, single thread. The synthetic inputs are mixed-source, with 2–6 punches/day, about 20% non-eligible statuses, and 25% of employees carrying two assignments.

| Workload | Time | Throughput |
| --- | --- | --- |
| One employee-day | p50 2.2 µs, p90 2.9 µs, p99 5.5 µs (p99.9 106 µs, OS noise) | — |
| 1,000 employee-days | 2.0 ms | ≈ 497k summaries/s |
| 2,000 employee-days | 4.2 ms | ≈ 475k summaries/s |
| 2,000 employees × 31 days (62,000 employee-days, 248k punches) | 141 ms | ≈ 438k summaries/s |

**Process:** 1.66 s CPU over 2.25 s wall, peak working set 49 MB. Most of that is the month's input set held in memory.

These numbers exclude reading punches from PostgreSQL, writing summaries, flag updates, audit rows and locking. In production those costs dominate by orders of magnitude, so the §8 load-test plan is what determines system capacity.

### 13.5 Database safety in RUST-03

- **Before database-backed tests:** a verified dev backup (`recafco_hrms_dev-20261108T114612Z.dump`) and the isolation suite 18/18.
- **Where the parity specs ran:** only in the guarded `recafco_hrms_test`.
- **Dev untouched:** row counts were identical before and after the 165-test run.
- **No migrations.**

## 14. Next unit — RUST-04: Biometric Database Integration and Identity Mapping Audit

Audit how real biometric devices and their databases will deliver events, and how device users map to RECAFCO employees (open finding F8 and fixture V44). This covers:
- the vendor, model and connection mode;
- device-local enrolment ids vs `employeeCode`;
- `sourceId` uniqueness scope;
- clock drift and sync delay;
- re-sync idempotency.

The audit is read-only toward any biometric database. It does not import live records into official attendance, and every proposed mapping table or connector is reviewed before implementation.
