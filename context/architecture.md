# RECAFCO HRMS — Architecture Context

## Stack

| Layer | Technology | Role |
| --- | --- | --- |
| Monorepo | pnpm workspace | One repository for web, API, mobile, database, and shared packages |
| Web | Next.js + TypeScript | HR/admin/manager/management/ESS web application |
| Mobile | React Native + TypeScript | Android and iOS app for employees and managers |
| Backend | NestJS + TypeScript | API, business logic, attendance engine, integrations, background job coordination |
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
