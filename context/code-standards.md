# RECAFCO HRMS — Code Standards

## General Principles

- Build small, single-purpose modules.
- Fix root causes, do not layer workarounds.
- Do not mix unrelated concerns in one component, service, route, or migration.
- Write code for enterprise reliability, not demo speed.
- Payroll-critical code must be explicit, tested, auditable, and easy to review.
- Prefer clear boring code over clever abstractions.
- Never bypass the attendance engine for convenience.
- Never silently ignore failed validations.

## TypeScript

- Strict TypeScript is required across web, API, mobile, and shared packages.
- Avoid `any`; use explicit interfaces, typed DTOs, discriminated unions, or `unknown` with validation.
- Validate unknown external input at system boundaries.
- Use shared enums/status constants from `packages/shared`.
- Do not duplicate business enums across apps.
- Keep date/time types explicit.
- Do not use local device time as official attendance time.

## Backend / NestJS

- Organize by domain module: auth, employees, attendance, shifts, locations, devices, leave, documents, reports, approvals, audit.
- Use controllers only for request/response mapping.
- Put business logic in services.
- Use guards for authentication and permissions.
- Use pipes/Zod/class-validator validation consistently.
- Every mutation must enforce backend authorization.
- Every payroll-critical mutation must create audit log.
- Use transactions for multi-step attendance state changes.
- Use idempotency keys or duplicate hashes for device imports and mobile punch retries.
- Do not perform heavy reporting or long-running imports directly inside request handlers.
- Queue heavy work with BullMQ.

## Attendance Engine Rules

- All punch sources must write to `attendance_raw_punches`.
- Do not update daily summary without storing raw punch/correction event.
- Official IN/OUT must be derived deterministically.
- Store rejected punches.
- Store suspicious punches.
- Store duplicate punches.
- Store raw device payload for imports.
- Use server time as official received time.
- Store source time separately.
- Recalculate daily summaries through one service/function.
- Attendance rule changes must be effective-dated or versioned once payroll policies are active.
- Never edit locked payroll summaries without approved correction workflow.

## Mobile Attendance Rules

- Backend must not trust mobile-provided validation results.
- Mobile may send GPS, accuracy, device info, Wi-Fi/QR/selfie proof, app integrity signals.
- Backend makes final decision.
- Mobile must handle rejected, pending, and accepted states clearly.
- Mobile punch submission should be idempotent to prevent duplicate records on retry.
- Securely store tokens.
- Do not store sensitive employee data unencrypted on device.
- Offline punch queuing must be explicitly approved by policy before implementation.

## Database and Prisma

- Every migration must be reviewed before applying to production.
- Production migrations require backup-first process.
- Use indexes for attendance queries by employee/date/status/source.
- Use unique constraints for device import deduplication.
- Use transactions for raw punch + summary recalculation + audit log where needed.
- Do not store large files in PostgreSQL.
- Store file metadata in DB and binary content in MinIO/S3.
- Use soft delete for employee/business entities where audit requires history.
- Raw attendance data should not be soft-deleted in normal flows.

## API Standards

- Use consistent response shape.
- Validate request body/query/params before logic.
- Enforce auth and permission before mutation.
- Return clear validation errors.
- Do not leak internal stack traces.
- Use pagination for list endpoints.
- Use filters for large HR/attendance tables.
- Use export jobs for large reports.
- Rate-limit sensitive endpoints such as login and punch submission.
- Log security-relevant failures.

## Web / Next.js

- Use server components by default where appropriate.
- Use client components only when browser interactivity is needed.
- Keep route-level data fetching clear.
- Use shared API client.
- Do not embed backend secrets in web.
- Protect routes based on authenticated session and permissions.
- Do not rely only on frontend permission checks.
- Use loading, empty, error, and success states.
- Use clear confirmation flows for destructive or payroll-sensitive actions.

## Mobile / React Native

- Keep business-critical decisions on backend.
- Use secure token storage.
- Use typed API client.
- Use stable navigation structure.
- Show punch result immediately after backend response.
- Handle poor GPS accuracy clearly.
- Handle permission-denied states clearly.
- Handle app updates gracefully.
- Avoid storing unnecessary HR data on device.

## Styling

- Use design tokens from `ui-context.md`.
- Do not hardcode colors in components.
- Use reusable status badge components.
- Use consistent spacing and radius.
- Do not create one-off UI patterns unless documented.
- Employee screens should be simple.
- HR screens may be dense but must remain readable.

## Security

- Never log passwords, tokens, civil IDs, salary, or personal documents.
- Use password hashing with strong algorithm.
- Use refresh token rotation/revocation.
- Enforce RBAC on backend.
- Audit all payroll-critical changes.
- Protect file downloads with authorization checks.
- Store secrets in environment variables, not source code.
- Use HTTPS in production/internal deployment where possible.
- Consider VPN/LAN-only access as deployment policy requires.

## Testing

Minimum expected tests for critical modules:

- Unit tests for attendance validation rules.
- Unit tests for official IN/OUT selection.
- Unit tests for duplicate punch handling.
- Unit tests for mixed mobile/device punch pairing.
- Unit tests for locked payroll period protection.
- Integration tests for mobile punch endpoint.
- Integration tests for device import idempotency.
- Permission tests for sensitive mutations.
- Basic E2E tests for core employee punch flow and HR correction flow.

A feature is not complete if it cannot be verified.

Test database safety (INCIDENT-02, mandatory):

- Integration tests use only the client from `apps/api/test/support/test-prisma.ts` (explicit `datasourceUrl` from `apps/api/.env.test`). Never import a shared/global Prisma client into tests or Jest global setup.
- `createTestApp()` always overrides the `PRISMA_CLIENT` token. Do not construct the Nest app for tests any other way.
- Any cleanup or other destructive statement goes through `runDestructiveTestOperation` (live identity + marker verification on the same transaction connection, plus the explicit `RECAFCO_TEST_DB_RESET` flag). Never call TRUNCATE/DELETE directly from test code.
- `pnpm --filter @recafco/api test:safety` must pass before any destructive suite is run.
- Run `infrastructure/backups/backup-database.mjs` against `recafco_hrms_dev` before migrations, bootstrap or test runs.

## Reliability and Performance

- Punch endpoint must be optimized for peak times.
- Save raw punch before heavy calculations.
- Queue recalculations when needed.
- Do not block punch request on report generation, notifications, or file processing.
- Add database indexes before large production usage.
- Add health endpoints for API, DB, Redis, MinIO, and worker.
- Use monitoring and logs for production visibility.
- Make deployment rollback-ready.

## File Organization

Recommended backend domains:

```txt
apps/api/src/auth
apps/api/src/employees
apps/api/src/attendance
apps/api/src/locations
apps/api/src/devices
apps/api/src/shifts
apps/api/src/leave
apps/api/src/documents
apps/api/src/reports
apps/api/src/approvals
apps/api/src/audit
apps/api/src/notifications
```

Recommended web domains:

```txt
apps/web/app
apps/web/components
apps/web/features
apps/web/lib
apps/web/hooks
```

Recommended mobile domains:

```txt
apps/mobile/src/screens
apps/mobile/src/features
apps/mobile/src/components
apps/mobile/src/services
apps/mobile/src/storage
apps/mobile/src/navigation
```

Recommended shared package:

```txt
packages/shared/src/enums
packages/shared/src/schemas
packages/shared/src/types
packages/shared/src/permissions
```

## Before Marking a Feature Complete

1. Implementation matches context specs.
2. Tests or manual verification completed.
3. Build/typecheck passes.
4. No architecture invariant was violated.
5. Audit logging added where required.
6. Permissions enforced on backend.
7. `progress-tracker.md` updated.
