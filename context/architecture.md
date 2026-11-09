# RECAFCO HRMS — Architecture Context

## Stack

| Layer | Technology | Role |
| --- | --- | --- |
| Monorepo | pnpm workspace | One repository for web, API, mobile, database, and shared packages |
| Web | Next.js + TypeScript | HR/admin/manager/management/ESS web application |
| Mobile | React Native + TypeScript | Android and iOS app for employees and managers |
| Backend | NestJS + TypeScript | API, business logic, attendance engine, integrations, background job coordination |
| Attendance engine (incremental) | Rust (Axum, Tokio, SQLx) | Future high-performance attendance-processing engine (`apps/attendance-engine`). RUST-01: health/readiness + read-only DB only; **not** on any live path. See "Rust Attendance Engine" below |
| Database | PostgreSQL | Source of truth for HRMS metadata, attendance, approvals, audit logs, and summaries |
| ORM | Prisma | Type-safe database access and migrations |
| Cache/Queue | Redis + BullMQ | Background jobs, device sync, report generation, notifications, recalculation queues |
| Storage | MinIO / S3-compatible | Employee documents, selfies, payslips, attachments, import files |
| Reverse Proxy | Nginx or Caddy | Internal routing, HTTPS, static/proxy configuration |
| Monitoring | Uptime Kuma, Prometheus, Grafana, Loki | Health checks, metrics, logs, uptime, alerting |
| Deployment | Docker Compose preferred; PM2 acceptable initially | Internal server deployment |
| Notifications | Firebase Cloud Messaging + in-app notifications | Mobile push and internal notification center |

## Monorepo Boundaries

```txt
recafco-hrms/
  apps/
    web/
    api/
    mobile/
    attendance-engine/   # Rust (cargo, not a pnpm workspace package)
  packages/
    db/
    shared/
    config/
  infrastructure/
    docker/
    nginx/
    backups/
    monitoring/
  docs/
    requirements/
    diagrams/
    deployment/
  context/
```

### `apps/web`

Owns:

- Next.js web routes and layouts
- HR/admin/manager/management/ESS UI
- Web authentication screens
- Web dashboard components
- Data fetching from API
- Web-only forms and tables

Must not own:

- Payroll-critical attendance calculation
- Direct database writes
- Secret business rules duplicated from backend
- Long-running report generation

### `apps/api`

Owns:

- NestJS modules
- Authentication and authorization enforcement
- Attendance engine
- Employee, location, shift, leave, document, approval, reports APIs
- Device sync APIs and adapters
- Audit logging
- Background job producers
- Validation of all external input

### `apps/mobile`

Owns:

- React Native app screens
- Mobile authentication flow
- GPS, camera, device info, secure storage, QR/Wi-Fi proof capture
- Offline-safe punch submission queue where policy allows
- Mobile UI for attendance, leave, documents, payslips, notifications

Must not own:

- Final attendance calculation logic
- Trust decisions
- Payroll logic
- Silent correction logic

### `apps/attendance-engine` (Rust)

Owns (RUST-01):

- `GET /health` (liveness) and `GET /ready` (real database round-trip, fails closed unless the session is read-only)
- Environment config (`ATTENDANCE_ENGINE_*` prefix only), JSON structured logging, graceful shutdown
- A lazy, bounded, **read-only** PostgreSQL pool (`default_transaction_read_only=on` on every session)
- Future (RUST-02+): pure, I/O-free attendance rule functions proven equal to the NestJS implementation

Must not own (until an explicit cutover unit changes this file):

- Any write to HRMS tables — official summaries, `isOfficial` flags, raw punches, employees, payroll locks, devices
- Schema or migrations (Prisma in `packages/db` is the only schema authority; no sqlx migrations)
- End-user authentication/RBAC (NestJS stays authoritative; the engine will only authenticate calling services)
- Any position in the live punch request path

Full design, audit, integration contract and reliability plan: `docs/architecture/rust-attendance-engine.md`.

### `packages/db`

Owns:

- Prisma schema
- Migrations
- Prisma client export
- Database seed scripts for development only
- Database model documentation where needed

Must not contain:

- Production demo data
- UI logic
- Business workflows beyond schema constraints

### `packages/shared`

Owns:

- Shared enums
- Shared DTO types
- Zod schemas safe to share across web/mobile/api
- Permission constants
- Status constants
- Date/time formatting helpers that are not business-critical

Must not contain:

- Server secrets
- Direct database client
- Backend-only business logic that could be tampered with on mobile/web

### `packages/config`

Owns:

- Shared TypeScript config
- ESLint/prettier config
- Environment variable schema helpers
- Build tooling conventions

## Core System Architecture

```txt
Web App              Mobile App             Punch Devices
   │                    │                         │
   └──────────┬─────────┘                         │
              │                                   │
              ▼                                   ▼
          NestJS API                    Device Integration Service
              │                                   │
              └───────────────┬───────────────────┘
                              ▼
                    Attendance Raw Punches
                              │
                              ▼
                    Attendance Validation Engine
                              │
                              ▼
                    Daily Attendance Summaries
                              │
                              ▼
                    Monthly Payroll Closing
```

## Attendance Architecture

Attendance must be designed as an event-based, payroll-safe system.

### Layer 1 — Raw Punches

Stores every attempt from every source.

Sources:

- MOBILE
- BIOMETRIC_DEVICE
- FACE_DEVICE
- CARD_DEVICE
- WEB
- MANUAL_CORRECTION
- IMPORT
- FUTURE_INTEGRATION

Raw punches are append-only. They are never deleted during normal operation.

#### Official punch time and retries (TIME-01)

| Source | Official instant (`punchTimeSource`) | `punchTimeServer` | Client clock |
| --- | --- | --- | --- |
| MOBILE (online) | **Server receipt time**, taken from the injectable `ClockService` as the first intake step | same receipt time | diagnostic `clientReportedTime` only; a `CLIENT_CLOCK_SKEW` flag (informational) when \|skew\| > 300 s |
| Device import | device event time (preserved, never replaced by sync time) | import receipt time | — |
| Manual / correction | requested time (approval workflow) | server time | — |

- Every rule — validation, the duplicate window, the Asia/Kuwait workDate and summary calculation — reads `punchTimeSource`. No client field can set or move it for mobile. Pre-TIME-01 mobile rows keep their historical (phone) time and have `clientReportedTime = NULL`.
- If intake processing is ever queued, the worker must use the stored receipt time, never its own execution time.
- **Mobile idempotency:** each intentional tap sends a client UUID `clientRequestId`, unique per `(employeeId, sourceType, clientRequestId)` at database level.
  - A retry with the same id and the same validation-relevant payload (SHA-256 fingerprint) returns the stored result (`Idempotent-Replayed: true`), with no new row and no recalculation.
  - The same id with a different payload → 409.
  - The duplicate window remains a separate business rule.
- **Mock location:** a client-reported mock or root signal (`mockLocationDetected`, `mocked`, `isMocked`, …) → `REJECTED_FAKE_GPS`, never automatic acceptance. This is a signal, not proof: GPS spoofing cannot be fully prevented client-side.

#### Recalculation locking (TIME-01)

- `AttendanceSummaryCalculatorService.calculateForEmployeeDate` runs the payroll-lock check, all reads, the `isOfficial` updates and the summary upsert in **one transaction**, under a per-employee/day advisory lock (`pg_advisory_xact_lock(hashtextextended('attendance-day:<employeeId>:<date>', 0))`).
- Inside that transaction it takes `FOR SHARE` on the covering payroll-lock rows. `PayrollLocksService.lockPeriod` takes `FOR UPDATE` on its period row as its first statement, so a period cannot become LOCKED between the check and the write. Both sides lock the period row before summary rows, so there is no deadlock.

### Layer 2 — Validation Results

Each punch receives validation status:

- ACCEPTED
- ACCEPTED_WITH_WARNING
- REJECTED_OUTSIDE_LOCATION
- REJECTED_FAKE_GPS
- REJECTED_UNREGISTERED_DEVICE
- REJECTED_EMPLOYEE_INACTIVE
- REJECTED_DUPLICATE
- PENDING_HR_REVIEW
- PENDING_MANAGER_APPROVAL
- REJECTED_POLICY_VIOLATION

Validation uses:

- Employee active status
- Assigned work location
- Geofence radius
- GPS accuracy
- Device binding
- Mobile integrity/fraud checks
- Punch source trust level
- Shift rules
- Duplicate rules
- Impossible travel detection
- Current attendance period status

### Layer 3 — Daily Summary

Daily summary is derived from accepted/approved punch events.

Default official selection:

- Official IN = earliest valid IN punch for the attendance date
- Official OUT = latest valid OUT punch for the attendance date

This supports:

- Mobile IN + device OUT
- Device IN + mobile OUT
- Device IN + device OUT
- Mobile IN + mobile OUT
- Multiple duplicate punches without corrupting official result

### Layer 4 — Corrections

Corrections do not rewrite raw events. Corrections create approved adjustment records that affect daily summary recalculation.

Every correction requires:

- Requester
- Reason
- Before value
- After value
- Approval status
- Approver
- Timestamp
- Audit log
- Optional attachment/evidence

### Layer 5 — Payroll Closing

Monthly payroll closing uses only approved `attendance_daily_summaries`.

After a period is locked:

- No silent edits
- Changes require reopening or post-lock correction workflow
- Finance approval may be required if payroll has already been processed
- Every change must be auditable

## Monthly Attendance Payroll Basis (Unit 20.2)

- `apps/api/src/payroll-attendance/` is a **read-only** NestJS reporting module: `GET /payroll-attendance/monthly` (paginated, max 100), `/monthly/summary` (all matching employees), and `/monthly/:employeeId` (daily breakdown). Permission: `payrollAttendance.read`.
- **Input:** stored daily summaries, shift assignments, punch counts, pending corrections and payroll locks. It never recalculates summaries, never writes, and computes minutes and day counts only (**no money**).
- **Snapshot:** each request is one `REPEATABLE READ, READ ONLY` transaction.
- **Unknowns stay `null` with exception codes.** Review statuses are `CALCULATED` / `NEEDS_REVIEW` / `INCOMPLETE` / `LOCKED`, and none of them means payroll approval.
- Full rules: `docs/architecture/shift-payroll-rules.md` §3.

### HR web UI (Unit 21)

- **Routes** (admin sidebar group "Payroll & Attendance"):
  - `/payroll-attendance`: monthly overview plus the employee table. Requires `payrollAttendance.read`.
  - `/payroll-attendance/[employeeId]?month=`: daily breakdown. Requires `payrollAttendance.read`.
  - `/payroll-locks`: Monthly Closing. Requires `payrollLocks.read`; create, lock and unlock each follow their own backend permission.
  - Routes and buttons are hidden without permission, but the backend RBAC is authoritative.
- **Calls only the existing endpoints:** `/payroll-attendance/monthly`, `/monthly/summary`, `/monthly/:employeeId`, `GET/POST /payroll-locks` and `POST /payroll-locks/:id/{lock,unlock}`. There is no client-side calculation of totals and no separate lock engine.
- **Display rules:**
  - `null` → "—"/"Not calculated", never zero.
  - Partial sums are labelled "Known so far".
  - Company-wide figures come only from `/monthly/summary`, never from a table page.
  - Statuses are shown as icon + label + explanation; neither Calculated nor Locked is presented as payroll approval.
- **Fetching:**
  - Explicit Refresh; no polling, no automatic retry, no refetch on focus.
  - `gcTime: 0` for payroll figures, so nothing is cached after leaving the page.
  - Stale requests are aborted via `AbortSignal`.
  - Server pagination, at most 100 rows.
- **Closing readiness:** since Unit 21.1 the Lock dialog shows backend readiness, which replaced the earlier acknowledgement checkbox. Lock is disabled unless ready, readiness is re-checked just before submitting, and a 409 refreshes the state. The backend is the control, not the button.

### Payroll Closing Readiness (Unit 21.1)

- **Readiness endpoint:** `GET /payroll-locks/:id/readiness` (`payrollLocks.read`), evaluated in a `REPEATABLE READ, READ ONLY` snapshot. It returns:
  - `ready`, exact `periodStart`/`periodEnd`, `employeesEvaluated`, `employeeDaysEvaluated`;
  - `scheduledWorkingDaysKnown: false`;
  - `blockingIssueCount`, `warningCount`, `affectedEmployees`/`affectedEmployeeDays`, `periodIssues`;
  - `issuesByType{code:{severity,employeeDays,employees}}`;
  - `sampleIssues`: at most 50, each with id, code, name, date and codes only;
  - `sampleTruncated` and `evaluatedAt`.
- **Enforcement:** `POST /payroll-locks/:id/lock` evaluates the **same** readiness inside its own transaction, after `FOR UPDATE` on the period row.
  - Not ready → rollback, a `PAYROLL_PERIOD_LOCK_REFUSED_NOT_READY` audit row, and `409 {code: PAYROLL_PERIOD_NOT_READY, reasonCodes, readiness}`.
  - A successful lock's audit includes the readiness summary.
  - **No override exists** for any role.
- **Concurrency:**
  - Recalculations and (since 21.1) correction approvals take `FOR SHARE` on covering period rows *inside* their write transactions, so they serialise with the lock.
  - Punches and decisions are covered fail-closed by pending and content-based staleness detection.
- **Rules:** `docs/architecture/shift-payroll-rules.md` §4.
- **Fail-closed consequence:** with no working calendar, days with no record block as `WORK_CALENDAR_NOT_CONFIGURED`, so real periods are not lockable until the HR-POLICY unit.
- **Cost:** about 1 s of SQL plus the reused Unit 20.2 evaluation. At 2,000 × 28 that's readiness ≈ 6–10 s and lock ≈ 8–12 s (noisy dev machine).

### Working Calendar (HR-POLICY-01)

- **Module:** `apps/api/src/work-calendars/` with a pure resolver (`work-calendar.resolver.ts`, `work-calendar-resolver/1`) and a bulk loader (`work-calendar.loader.ts`).
  - The loader is a plain function, not a provider, so the Unit 20.2 report and Unit 21.1 readiness can call it on their own transaction without a module cycle.
  - It loads only ACTIVE records.
- **Tables** (additive migration `20261109090000_hr_policy_01_working_calendar`): `work_calendars`, `work_calendar_assignments` (EMPLOYEE/SHIFT scope, dated), `work_calendar_day_overrides`, `public_holidays`.
  - Lifecycle: DRAFT → ACTIVE (approval reference + actor; enforced by CHECK) → INACTIVE (with a reason).
  - Nothing is ever deleted (`ON DELETE RESTRICT`).
- **Endpoints:**
  - `GET/POST/PATCH /work-calendars`, `POST /work-calendars/:id/activate`, `GET /work-calendars/:id/preview?month`;
  - `GET/POST /work-calendars/assignments`, `POST /work-calendars/assignments/:id/end`;
  - `GET/POST /work-calendars/overrides`, `POST …/:id/activate|deactivate`;
  - `GET /work-calendars/coverage?month`, `GET /work-calendars/employees/:id/preview?month`, `GET /work-calendars/shift-options`;
  - `GET/POST/PATCH /public-holidays`, `POST /public-holidays/:id/activate|deactivate`.
- **Permissions:**

  | Permission | Allows | Granted to |
  |---|---|---|
  | `workCalendars.read` | viewing | HR_ADMIN, HR_MANAGER, PAYROLL_OFFICER, AUDITOR, MANAGEMENT_VIEWER |
  | `workCalendars.manage` | creating and editing drafts | HR_ADMIN, HR_MANAGER |
  | `workCalendars.activate` | approve/deactivate, assign/end | **SUPER_ADMIN only** until decision HRP-02 |

- **Integration:**
  - The Unit 20.2 `calculateMonths` loads the calendar context per 250-employee chunk with fixed queries. Each `DailyBreakdown` carries a `calendar` resolution.
  - Unit 21.1 readiness clears verified idle non-working days and blocks UNKNOWN days, scheduled-but-absent days, work on non-working days and conflicts.
- **Coordination:** every classification-changing write calls `PayrollLockGuardService.assertDateRangeNotLockedInTransaction` (`FOR SHARE` on overlapping lock rows, refuse if LOCKED) inside its transaction, the same scheme as summary recalculation versus `lockPeriod`'s `FOR UPDATE`.
- **Web:** admin sidebar group "Working Calendar" with `/work-calendars`, `/public-holidays` and `/calendar-coverage`; the employee daily breakdown shows a "Day type" column.
- **Not built:**
  - Leave integration: no leave module exists, so `APPROVED_LEAVE` is never produced.
  - Location-scoped rules: there is no location history.
  - Compensation rules.
- **Rules and decisions:** `docs/architecture/shift-payroll-rules.md` §5 and `docs/architecture/hr-policy-decision-register.md`.

## Rust Attendance Engine

Introduced incrementally (strangler pattern), never as a rewrite of NestJS. Phases:

| Phase | Computes official summaries | Writes them | Engine DB access |
| --- | --- | --- | --- |
| 0 — RUST-01 (current) | NestJS | NestJS | read-only, unused |
| 1 — RUST-02/03 parity (**done**: validation 67/67, daily summary 48/48) | NestJS; Rust only against shared golden test vectors (`packages/attendance-test-vectors`) | NestJS | read-only |
| 2 — shadow | NestJS (official) + Rust (shadow, diff only) | NestJS | read-only |
| 3 — cutover (future, separately approved) | Rust | Rust only | scoped write role |

Rules:

1. Exactly one component may write `attendance_daily_summaries` / `attendance_raw_punches."isOfficial"` at any time. A cutover requires a Prisma-owned ownership switch read inside the writing transaction plus a per-employee/day `pg_advisory_xact_lock` taken by every writer.
2. The punch request path never waits on the engine.
3. Internal calls: loopback/private network only, per-caller bearer token, `/v1` URL versioning, explicit `rulesetVersion`, audit identity propagated via `X-Request-Id` / `X-Actor-Type` / `X-Actor-User-Id` / `X-Origin`.
4. Durable work (phase 3) uses a PostgreSQL job table (`FOR UPDATE SKIP LOCKED`, leases, coalescing per employee/day). Redis/BullMQ is not required for the attendance path at RECAFCO scale; revisit only on measured evidence.
5. Rust SQL references Prisma physical names (`@@map` tables, quoted camelCase columns); compile-time-checked queries require committed `cargo sqlx prepare` offline data.
6. Development port `4100`, bound to `127.0.0.1`. Never exposed through the reverse proxy.
7. The Rust domain (`apps/attendance-engine/src/domain`) contains pure, clock-free ports of punch validation (RUST-02) and the daily summary calculator (RUST-03). Each reproduces the current NestJS rules exactly, including documented defects, and is pinned by versioned parity fixtures (`rulesetVersion nest-post-time01-2026-11-08`). A rule change requires: an HR decision, a new `rulesetVersion`, re-recorded fixtures, and the same change in both implementations.
8. Payroll-grade shift rules (grace, breaks, overnight pairing, weekends, holidays, leave, approved overtime, absence) are **designed, not active**: `docs/architecture/shift-payroll-rules.md`. A company-wide weekend default must never override an employee's own schedule. The live working-time display contract is in `docs/architecture/live-attendance-timer-contract.md`.
9. **Biometric source integration (RUST-04):** the source database is vendor-managed, separate, and also read by Pinnacle. The HRMS may only ever read it, through a dedicated read-only login provided by RECAFCO IT, and must never write to it, create triggers, tables or indexes on it, read biometric templates, or disrupt Pinnacle. Connector rules (`apps/attendance-engine/src/biometric`, `docs/architecture/biometric-integration.md`):
   - device event time is official and sync time is separate;
   - `sourceId` is a source/device-scoped idempotency key, never a raw log number;
   - enrolment → employee mapping is effective-dated, device-scoped first, never by name;
   - unknown device, employee or direction, ambiguous mappings and clock-ahead events are **held**, never guessed;
   - direction is never inferred from event order without HR policy;
   - the incremental checkpoint advances only past fully handled events.

   **No source access exists yet; nothing is connected.**

## Test Database Isolation and Backups (INCIDENT-02)

Introduced after INCIDENT-01, when an automated test run truncated `recafco_hrms_dev` (see `docs/incidents/INCIDENT-01-dev-database-truncation.md`).

| Concern | Rule |
| --- | --- |
| Prisma client construction | `@recafco/db` builds nothing at import time and never caches on `globalThis`. Use `createPrismaClient(explicitUrl)` (Prisma `datasourceUrl`) or the lazy `getSharedPrismaClient()`, which refuses to run under Jest. |
| API wiring | `DatabaseService` takes its client from the `PRISMA_CLIENT` DI token (`apps/api/src/database`). Production uses the shared client; tests always inject the explicit test client. |
| Test database | `recafco_hrms_test`, owned by role `recafco_test`: LOGIN only, no SUPERUSER/CREATEDB/CREATEROLE/INHERIT/REPLICATION/BYPASSRLS, no memberships. PUBLIC privileges revoked. Credentials only in the git-ignored `apps/api/.env.test`. Provisioned by `packages/db/scripts/provision-test-database.cjs` (admin tool). |
| Network/auth boundary | A role-scoped `pg_hba.conf` block before all other rules: `recafco_test` may connect only to `recafco_hrms_test` over loopback; every other database rejects it. |
| Development database | `REVOKE CONNECT, TEMPORARY ON DATABASE recafco_hrms_dev FROM PUBLIC`. Only explicitly granted roles and superusers can connect. |
| Destructive test operations | Only via `runDestructiveTestOperation` (`apps/api/test/support/database-guard.ts`). It requires `RECAFCO_TEST_DB_RESET=ALLOW_TRUNCATE_recafco_hrms_test`, then verifies the live `current_database()`, roles, loopback `inet_server_addr()`, `inet_server_port()` and the `test_guard.marker` row inside the same transaction that runs the operation. |
| Backups | `infrastructure/backups/backup-database.mjs`: identity-verified, timestamped, never-overwrite, `pg_restore`-verified custom-format dumps stored outside Git. Required before any unit that runs migrations, bootstrap or test suites. |

## Storage Model

### PostgreSQL

Stores:

- Users, roles, permissions
- Employees
- Departments, designations, projects/sites
- Work locations and geofence rules
- Shifts and shift assignments
- Mobile device registrations
- Punch device metadata
- Raw attendance punches
- Daily summaries
- Corrections and approvals
- Leave requests and balances
- Documents metadata
- Payslip metadata
- Announcements
- Notification records
- Audit logs
- Payroll closing records

### MinIO / S3-Compatible Storage

Stores:

- Employee documents
- Civil ID/passport/visa copies
- Payslip PDF files
- Mobile punch selfie images
- HR request attachments
- Device import files
- Generated reports if persisted

Large files must not be stored directly in PostgreSQL.

### Redis

Stores:

- Queue jobs
- Short-lived cache
- Rate limit counters
- Temporary locks for punch submission and recalculation
- Background job state where appropriate

Redis must not be the source of truth for attendance or payroll data.

## Auth and Access Model

- All users authenticate through the API.
- Web and mobile use JWT access tokens with refresh tokens.
- Refresh tokens must be securely stored and revocable.
- Mobile app uses secure storage for tokens.
- RBAC controls every feature.
- Permission checks happen on the backend for every mutation.
- UI permissions are only for presentation; backend is authoritative.
- Audit logs are created for all payroll-critical changes.

## Suggested Permission Groups

- `employees.read`
- `employees.create`
- `employees.update`
- `attendance.punch.mobile`
- `attendance.punch.web`
- `attendance.read.self`
- `attendance.read.team`
- `attendance.read.all`
- `attendance.correct.request`
- `attendance.correct.approve.manager`
- `attendance.correct.approve.hr`
- `attendance.period.close`
- `attendance.period.reopen`
- `locations.manage`
- `devices.manage`
- `shifts.manage`
- `employees.disable`
- `departments.read` / `departments.create` / `departments.update` / `departments.disable`
- `designations.read` / `designations.create` / `designations.update` / `designations.disable`
- `workLocations.read` / `workLocations.create` / `workLocations.update` / `workLocations.disable`
- `attendanceDevices.read` / `attendanceDevices.create` / `attendanceDevices.update` / `attendanceDevices.disable` / `attendanceDevices.testConnection`
- `mobileDevices.read` / `mobileDevices.register` / `mobileDevices.approve` / `mobileDevices.block` / `mobileDevices.reset` / `mobileDevices.update`
- `attendancePunches.read` / `attendancePunches.createMobile` / `attendancePunches.createDeviceImport` / `attendancePunches.createManual` / `attendancePunches.readOwn` / `attendancePunches.validate`
- `attendanceSummaries.read` / `attendanceSummaries.readOwn` / `attendanceSummaries.calculate` / `attendanceSummaries.recalculate`
- `attendanceCorrections.read` / `attendanceCorrections.readOwn` / `attendanceCorrections.request` / `attendanceCorrections.approve` / `attendanceCorrections.reject`
- `leave.request`
- `leave.approve.manager`
- `leave.manage.hr`
- `documents.read.self`
- `documents.manage.hr`
- `payslips.read.self`
- `payslips.upload.hr`
- `reports.attendance`
- `reports.payroll`
- `system.audit.read`
- `system.settings.manage`

## Deployment Architecture

Preferred production:

```txt
Linux VM / internal server
  nginx
  web container
  api container
  worker container
  postgres
  redis
  minio
  uptime-kuma
  backup jobs
```

Acceptable early deployment:

```txt
Windows Server
  PM2 web/api/worker
  PostgreSQL service
  Redis via Docker or service alternative
  MinIO service
  Windows Task Scheduler backups
  Uptime Kuma or equivalent
```

## Reliability Requirements

1. Attendance punch endpoint must be lightweight and fast.
2. Punch save must happen before heavy calculations.
3. Heavy work must run in background jobs.
4. Reports must not block punch-in/out.
5. Device sync must be idempotent.
6. Database migrations must be backup-first.
7. Production deploys must be rollback-ready.
8. Monitoring must check web, API, database, Redis, MinIO, worker, and disk space.
9. Backups must be tested by restore, not only created.
10. Raw punch data must not be deleted during normal operation.

## Invariants

1. Raw punch records are append-only and must not be edited to hide history.
2. Payroll calculations must not use unapproved raw punches directly.
3. Attendance summaries must be derived from accepted/approved punches and approved corrections.
4. Payroll-locked periods cannot be silently modified.
5. Manual corrections require reason, approver, before/after values, and audit log.
6. Mobile app fraud checks are signals; backend validation is authoritative.
7. All external inputs must be validated at API boundaries.
8. Device imports must be idempotent using unique source keys or duplicate hashes.
9. Date/time must be stored in UTC with clear attendance-date calculation based on company policy/timezone.
10. Web/mobile clients must never contain secrets or final payroll logic.
11. Every permission-sensitive mutation must be enforced by backend guards.
12. File metadata belongs in PostgreSQL; file binaries belong in MinIO/S3 storage.
13. Recalculation must be deterministic: same input events and policy version produce same summary.
14. Attendance rule changes must be versioned or effective-dated.
15. No implementation may reduce auditability for convenience.
16. The NestJS API and the Rust attendance engine must never both calculate-and-write official attendance summaries for the same employee/date.
17. The Rust attendance engine connects read-only and owns no schema until an explicit, documented cutover unit says otherwise.
18. Automated tests never use development or production credentials, and never reach a database that is not the marker-verified `recafco_hrms_test`. A database connection's identity is proven by querying the live connection, never by the text of a URL or environment variable.
19. No destructive operation (TRUNCATE/DELETE/DROP/reset) runs against any database without a verified backup or an explicit, guarded test-database authorization.
20. The official time of an online mobile punch is the server receipt time. A client-supplied clock value is diagnostic metadata and never an input to attendance rules.
21. Every write of an employee/day summary or its official flags happens inside the per-employee/day advisory-locked transaction that also re-checks the payroll lock.
