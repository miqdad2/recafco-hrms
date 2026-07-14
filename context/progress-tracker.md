# RECAFCO HRMS — Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase

- Phase 1 — Foundation: Unit 1 (database package), Unit 1.1 (local migration verification), Unit 2 (NestJS API foundation), Unit 3 (Auth/RBAC foundation), and Unit 4 (Employee/Department/Designation/Work Location API foundation) complete; Attendance Device Registry API foundation (Unit 5) is next.

## Current Goal

Define a spec-driven foundation for building a fast, reliable, payroll-safe internal HRMS with web, Android, and iOS applications.

## Completed

- Initial product direction defined.
- System identified as internal RECAFCO HRMS for 2000+ employees.
- Core stack selected:
  - Next.js web
  - React Native mobile
  - NestJS backend
  - PostgreSQL database
  - Prisma ORM
  - Redis + BullMQ
  - MinIO/S3-compatible storage
  - pnpm monorepo
- Attendance identified as payroll-critical.
- Central attendance engine concept defined.
- Raw punch + validation + daily summary + correction + payroll lock model defined.
- Mixed mobile/device punch support defined.
- Fraud protection requirements identified:
  - Geofence
  - Device binding
  - Fake GPS detection
  - GPS accuracy validation
  - Optional selfie
  - Wi-Fi/QR/site validation
  - Device import audit
  - Manual correction audit
- Spec-driven context file set created.

- UNIT 1 — Database package foundation (`packages/db`) completed:
  - `@recafco/db` package created with Prisma (PostgreSQL provider), pinned to `prisma`/`@prisma/client` 6.19.3.
  - Prisma schema (`packages/db/prisma/schema.prisma`) defines: Department, Designation, WorkLocation, AttendanceDevice, Employee, MobileDevice, Shift, ShiftAssignment, AttendanceRawPunch, AttendanceDailySummary, AttendanceCorrection, AttendancePayrollLock, AuditLog.
  - Enums added: EmployeeStatus, EmploymentType, AttendanceSourceType, PunchType, PunchValidationStatus, DailyAttendanceStatus, CorrectionStatus, PayrollLockStatus.
  - No migration was run against a live database (no Postgres instance available in this environment) — only `prisma generate` and typecheck were verified. `db:migrate` (i.e. `prisma migrate dev`) still needs to run against a real Postgres instance before this schema is considered applied.
  - `packages/db/src/client.ts` exports a singleton `PrismaClient` (dev-mode global caching pattern); `src/index.ts` re-exports it plus all Prisma-generated types.
  - Root `.gitignore` added (previously missing) to keep `.env`, `node_modules`, and build output out of version control, since a real `.env` with a live DB password already existed untracked in the working tree.

- UNIT 1.1 — Local PostgreSQL migration verification completed:
  - Local PostgreSQL 18 server confirmed running and reachable on `localhost:5432` (existing Windows service `postgresql-x64-18`).
  - Database `recafco_hrms_dev` created (did not previously exist).
  - `packages/db/.env` created (gitignored, not committed) by copying the root `.env` value, since Prisma CLI resolves `.env` relative to its own working directory, not the repo root.
  - Migration `20260714054603_init` created and applied via `prisma migrate dev` — applied cleanly against the schema from Unit 1 with **no schema changes needed**.
  - Verified all 13 model tables + `_prisma_migrations` exist in `recafco_hrms_dev` (`\dt` via psql), and confirmed no rows exist in `employees`/`departments`/`attendance_raw_punches` (no demo data was created).
  - `pnpm --filter @recafco/db db:generate`, `pnpm --filter @recafco/db typecheck`, and root `pnpm typecheck` all pass.
  - Operational gotcha found and worth remembering: `pnpm --filter @recafco/db db:migrate -- --name <name>` mis-forwards the `--` separator into the underlying `prisma migrate dev` invocation, causing Prisma to ignore `--name` and drop into an interactive "enter a migration name" prompt (which hangs indefinitely in a non-interactive shell, and can leave an orphaned `node`/`prisma` process holding the Postgres advisory lock — check for and kill it before retrying). Workaround used: run `pnpm exec prisma migrate dev --name <name>` directly from inside `packages/db` instead of through the `db:migrate` package script when a migration name must be supplied non-interactively.

- UNIT 2 — NestJS API foundation + database connection completed:
  - `@recafco/api` created in `apps/api` (NestJS 11.1.28, strict TypeScript, source under `apps/api/src`).
  - **Fixed a real packaging bug in `@recafco/db` discovered while wiring this unit**: the package previously had `"type": "module"` with `"main"`/`"types"` pointing straight at raw `.ts` source. That resolves fine for bundler-based consumers (Next.js) but a CommonJS Node process (`node dist/main.js`, which is exactly how the built API runs) cannot `require()` a `.ts` file — it would have crashed at runtime with `MODULE_NOT_FOUND`/syntax errors the first time the API tried to import `@recafco/db`. Fixed by giving `packages/db` a real build step: added `packages/db/tsconfig.build.json` (emits CommonJS to `packages/db/dist`), changed its `build` script to `tsc -p tsconfig.build.json` (previously incorrectly aliased to `tsc --noEmit`, duplicating `typecheck`), and pointed `main`/`types` at `./dist/index.js`/`./dist/index.d.ts`. Verified the compiled output is `require()`-able from plain Node. **`packages/shared` has the same latent issue** (`"type": "module"`, raw-`.ts` `main`) but was left untouched since nothing in this unit consumes it yet — fix it the same way before any CommonJS app (`apps/api`, `apps/mobile`) imports it.
  - `DatabaseModule` (`@Global()`) + `DatabaseService` wrap the existing singleton `prisma` client exported by `@recafco/db` (no second `PrismaClient` instantiated). `onModuleInit` attempts `$connect()` but only logs a warning on failure rather than throwing, so the API still boots and `/health` still works even if PostgreSQL is down; `onModuleDestroy` calls `$disconnect()`, wired up via `app.enableShutdownHooks()` in `main.ts`.
  - `HealthModule`: `GET /health` (always returns `status/service/timestamp`, no DB dependency) and `GET /health/db` (runs `SELECT 1` via Prisma; returns `503 Service Unavailable` with a generic `status/database/timestamp` body — no stack trace or connection string — if the query fails; failure is logged server-side only).
  - Typed env config via a small `zod` schema (`apps/api/src/config/env.schema.ts`) wired into `@nestjs/config`'s `validate` option: `NODE_ENV` (enum, default `development`), `API_PORT` (coerced int, default `4000`), `DATABASE_URL` (required, non-empty). Kept local to `apps/api` rather than creating a `packages/config` env-schema module — `architecture.md` says `packages/config` should eventually own shared env-schema helpers, but nothing else needs env validation yet, so extracting a shared package now would be speculative; flagged as an open question below.
  - `main.ts`: global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`), CORS restricted to `http://localhost:3000` and `http://localhost:19006` (credentials enabled, no wildcard), explicit `1mb` body size limit via `express`'s `json()`/`urlencoded()`, `app.enableShutdownHooks()`.
  - Root `package.json` gained `dev:api` (builds `@recafco/db` then runs `@recafco/api` dev) without touching the existing `dev`/`build`/`lint`/`typecheck`/`db:*` scripts. `turbo.json`'s `dev` task now has `dependsOn: ["^build"]` so `turbo dev` always builds workspace library deps (like `@recafco/db`) before starting persistent app dev tasks — needed for the same reason as the `@recafco/db` packaging fix above.
  - **Second operational gotcha found and fixed at the root cause**: `apps/api/nest-cli.json` initially had `"deleteOutDir": true`, which raced with `nest start --watch`'s incremental compiler on this machine — the CLI wiped `dist/` right as it tried to run the freshly compiled `dist/main.js`, crashing with `MODULE_NOT_FOUND` on the very first watch-mode boot. Root-caused (not just a stale-cache issue: a clean rebuild reproduced it) and fixed by setting `"deleteOutDir": false` in `nest-cli.json` — `nest build` (one-shot production build) is unaffected. Also added `*.tsbuildinfo` to `.gitignore` (TypeScript's incremental build cache; was untracked but not previously ignored).
  - Verified end-to-end: `pnpm install`, `pnpm --filter @recafco/api typecheck`, `pnpm --filter @recafco/api build`, `pnpm typecheck` (root, all 3 packages) all pass. Ran `pnpm --filter @recafco/api dev`, confirmed `GET /health` → `200 {"status":"ok","service":"recafco-hrms-api","timestamp":...}` and `GET /health/db` → `200 {"status":"ok","database":"connected","timestamp":...}` against the real `recafco_hrms_dev` database, confirmed CORS preflight allows `http://localhost:3000` with `Access-Control-Allow-Credentials: true`, then cleanly stopped the verification server and confirmed port 4000 was released.
  - `apps/api/.env` created (gitignored, not committed) the same way as `packages/db/.env` in Unit 1.1 — copied `DATABASE_URL`/`API_PORT` from root `.env`, added `NODE_ENV=development`, password never printed.

- UNIT 3 — Auth/RBAC foundation completed:
  - **Schema**: added `UserStatus` enum (`ACTIVE`/`DISABLED`) and six models — `User`, `Role`, `Permission`, `UserRole`, `RolePermission`, `RefreshToken`. `Role`/`Permission` are DB-backed rows with a unique `code` string (not Prisma enums), matching the spec's intent that they be extensible without a migration. Migration `20260714061307_auth_rbac_foundation` created and applied via `pnpm exec prisma migrate dev --name auth_rbac_foundation` from `packages/db` (per the operational note, not through the broken `--filter ... -- --name` path). Verified all 6 new tables (`users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `refresh_tokens`) exist via `psql \dt`.
  - **Converted the 3 named plain-string user-ID fields to real relations**, since `attendance_corrections` and `audit_logs` were both empty (confirmed in Unit 1.1) and this was explicitly safe: `AttendanceCorrection.requestedByUserId` → `requestedBy User` (required, relation name `CorrectionRequestedBy`), `AttendanceCorrection.approvedByUserId` → `approvedBy User?` (relation name `CorrectionApprovedBy`), `AuditLog.actorUserId` → `actor User?`. `AttendancePayrollLock.lockedByUserId`/`reopenedByUserId` were deliberately **not** converted — the task only asked for the three fields above, so those stay plain strings for now (see open questions).
  - **`PasswordResetToken` was deliberately not built** — out of scope per the unit's own exclusions (no email/OTP yet), and the task marked it optional/only-if-needed.
  - **Password hashing**: tested `argon2` directly on this Windows machine first (hash+verify round-trip) before committing to it — it installed and ran with zero native-build friction (prebuilt binary via `node-gyp-build`), so used `argon2id` per the task's stated preference rather than falling back to `bcryptjs`. Added `argon2` to `pnpm-workspace.yaml`'s `onlyBuiltDependencies`/`allowBuilds` (same pattern as Prisma in Unit 1).
  - **JWT design**: access tokens (`JWT_ACCESS_SECRET`, default 15m) carry `{ sub, username, roles, permissions }` so `PermissionsGuard` never needs a DB round-trip per request. Refresh tokens (`JWT_REFRESH_SECRET`, default 7d) are *also* real signed JWTs (`{ sub, jti }`) per the task's explicit env-var design, but the DB (`refresh_tokens.tokenHash`, a SHA-256 hex hash of the full JWT string) is the actual source of truth for validity/revocation — a stolen-but-expired-in-DB JWT is rejected even if its own `exp` claim hasn't elapsed, and vice versa. Refresh tokens are rotated on every use (old row's `revokedAt` set, a new row + token issued) — verified manually that reusing a pre-rotation refresh token is rejected with 401. Raw refresh tokens are never stored, only their hash.
  - **RBAC**: 17 permissions and the 9 system roles from `context/architecture.md`'s suggested permission groups / this task's role list, defined in `apps/api/src/auth/constants/rbac.constants.ts` along with a provisional role→permission default mapping (documented as provisional in an open question below — not confirmed HR policy). `@Permissions(...)` decorator + `PermissionsGuard` (reads `request.user.permissions`, populated by `JwtStrategy` from the access token) is the reusable route-protection mechanism; `JwtAuthGuard` handles authentication. No permanent demo/test route was added — `GET /auth/me` (JWT-only, no specific permission) was sufficient to verify the guard chain.
  - **Endpoints**: `POST /auth/login` (identifier = username or email + password; generic "Invalid credentials" for every failure mode — unknown user, wrong password, disabled, locked — so none are distinguishable from outside), `POST /auth/refresh` (rotates), `POST /auth/logout` (revokes the presented refresh token; idempotent — an already-revoked or unknown token is a silent no-op, not an error), `GET /auth/me` (JWT-protected, returns id/username/email/employeeId/status/mustChangePassword/lastLoginAt/roles/permissions — never `passwordHash`).
  - **Lockout**: 5 failed attempts locks the account for 15 minutes (`lockedUntil`), and `failedLoginAttempts` resets to 0 at the moment of locking (so the next window after expiry starts clean rather than accumulating). A correct password presented while locked is still rejected (verified manually) — the lock check happens before password verification, so no argon2 CPU cost is spent on a locked account.
  - **Audit**: `AuditService` (`@Global()`, in `apps/api/src/audit/`) wraps `auditLog.create` in a try/catch that only logs a warning on failure rather than throwing, so a transient audit-write problem can't itself block a login/logout/refresh. Records `LOGIN_SUCCESS`, `LOGIN_FAILED` (with a `reason` in `afterSnapshot`: `not_found`/`disabled`/`locked`/`invalid_password`), `USER_LOCKED`, `REFRESH_TOKEN_USED`, `LOGOUT`, and `BOOTSTRAP_SUPER_ADMIN_CREATED`. Verified all of these actually appear in `audit_logs` in the correct order during manual testing.
  - **Bootstrap script**: `apps/api/src/bootstrap/create-super-admin.ts`, run via `pnpm --filter @recafco/api create:super-admin` (uses `ts-node`, added as a devDependency). Reads `BOOTSTRAP_ADMIN_USERNAME`/`BOOTSTRAP_ADMIN_PASSWORD`/`BOOTSTRAP_ADMIN_EMAIL` from `.env` (loads it itself via the `dotenv` package, since `ts-node` doesn't auto-load `.env` the way Nest's `ConfigModule` or the Prisma CLI do — a real gap, not just a one-off test issue, so `dotenv` was added as a proper dependency, not worked around). Upserts all 17 permissions and 9 roles (idempotent), skips user creation entirely if the username already exists (verified by running it twice), never touches the `employees` table, never logs the password. Rejects passwords under 12 characters.
  - **Reused `@recafco/db`'s existing CommonJS build fix from Unit 2** — no new packaging work needed since Auth code imports `@recafco/db` (already fixed) and does **not** import `@recafco/shared` (deliberately — see open questions; its enum values were used as a naming reference only, not imported, to avoid re-triggering the same raw-`.ts`-`main` problem in a new package).
  - Verified end-to-end against the real `recafco_hrms_dev` database: `pnpm install`, `db:generate`, `@recafco/db typecheck`, `@recafco/api typecheck`, `@recafco/api build`, root `pnpm typecheck` all pass. Ran the bootstrap script (twice, to confirm idempotency), started `pnpm --filter @recafco/api dev`, and manually exercised the full flow: `/health` and `/health/db` still 200, login → 200 with token pair, `/auth/me` → 200 with correct profile/roles/permissions and no password hash, refresh → 200 with rotated tokens + old token now rejected, logout → 200 + the logged-out token now rejected, 5× wrong password → generic 401 each time + correct password rejected once locked, confirmed via direct `psql` query that `lockedUntil`/`failedLoginAttempts` and the full audit trail matched expectations. Cleanly stopped the verification server afterward (had to explicitly `Stop-Process` the two child PIDs, same `TaskStop`-doesn't-kill-grandchildren caveat as Unit 2) and confirmed port 4000 was released; did not touch the unrelated `recafco-maintenance-management-system` Next.js dev processes running on this machine.

- UNIT 4 — Employee/Department/Designation/Work Location API foundation completed:
  - **Schema**: added `WorkLocationType` enum (`OFFICE`/`FACTORY`/`WAREHOUSE`/`PROJECT_SITE`, default `OFFICE`) + `WorkLocation.type` field, and `Employee.civilId` (nullable, unique). `Department`/`Designation`/`WorkLocation.isActive` already existed from Unit 1 — no migration needed for those, contrary to the task's assumption that they might be missing.
  - **Migration `20260714063921_master_data_api_foundation`** applied via a workaround: `prisma migrate dev --create-only` (and even plain `migrate dev`) refused non-interactively because adding the `civilId` unique constraint triggers a data-loss-style warning prompt, and this environment has no TTY to confirm it — piping `y` into stdin didn't help either, since Prisma explicitly detects non-interactive environments and refuses regardless of piped input. Root-caused instead of forced: generated the exact SQL via `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel ./prisma/schema.prisma --script` (fully non-interactive, no prompts), hand-created the standard `<timestamp>_master_data_api_foundation/migration.sql` folder with that output, then applied it with `prisma migrate deploy` (never prompts, exactly as the CLI's own error message suggested). Verified the generated SQL was correct before applying, and confirmed via `psql` afterward that `civilId`/`type` landed exactly as expected. This is a real, repeatable gotcha for any future migration that would trigger a Prisma warning prompt (a new required column with a default is fine and doesn't prompt; a new unique constraint on an existing column can prompt even on an empty table) — the `migrate diff` + hand-built-folder + `migrate deploy` sequence is the reliable non-interactive workaround.
  - **13 new permissions** added to `apps/api/src/auth/constants/rbac.constants.ts`: `employees.disable` (was missing since Unit 3 despite `employees.read/create/update` existing) plus `departments.*`/`designations.*`/`workLocations.*` (`read`/`create`/`update`/`disable` each). Total permission count: 17 → 30. Role→permission mapping follows the existing Unit 3 pattern (elevated `*.disable` actions reserved for `HR_MANAGER`, not `HR_ADMIN`; read-only master-data visibility given to `DEPARTMENT_MANAGER`/`SUPERVISOR`/`PAYROLL_OFFICER`/`AUDITOR`/`MANAGEMENT_VIEWER`). `SUPER_ADMIN` needed no manual change since its permission list is derived (`ALL_PERMISSION_CODES`), not hardcoded. Re-ran `pnpm --filter @recafco/api create:super-admin` (idempotent) to upsert the new permissions/role-links onto the existing bootstrapped roles — verified `/auth/me` for the existing `superadmin` user went from 17 to 30 permissions without needing to recreate the user. Also appended the new permission codes to `architecture.md`'s "Suggested Permission Groups" list to keep it in sync (that list was already visibly out of sync with Unit 3's actual implementation before this — not fully reconciled here, see open questions).
  - **Four new feature modules** (`departments`, `designations`, `work-locations`, `employees`), each following an identical Controller → Service → DTO pattern: `JwtAuthGuard` + `PermissionsGuard` on the controller, `@Permissions('<domain>.read'|'create'|'update'|'disable')` per route, paginated `GET` list (page/limit/search + relevant filters), `GET /:id` (404 if missing), `POST` (create), `PATCH /:id` (field update, does not touch `isActive`/`status` directly for the domains where that's a deliberate separate action), and `DELETE /:id` mapped to a **soft** deactivate/terminate — no row is ever physically deleted. Every create/update/deactivate is audited (before/after snapshots, actor, IP, user-agent); read endpoints are not audited, per the task's own instruction.
  - **Naming choices kept the existing schema's field names rather than renaming to match the task's prose exactly**: `Designation.title` (task said "name"), `WorkLocation.geofenceRadiusMeters` (task said "allowedRadiusMeters" — same concept, pre-existing established term from Unit 1's fraud/geofence context), `Employee.hireDate` (task said "joiningDate"), `Employee.firstName`/`lastName` (task said "fullName" — the API response adds a derived, non-persisted `fullName` convenience field instead of renaming the stored columns). Renaming real columns for purely cosmetic reasons wasn't judged worth a migration.
  - **`EmployeesModule` specifics**: `departmentId`/`designationId`/`workLocationId` existence is checked in the service layer before any write (`assertReferencesExist`), returning a clean `400 Bad Request` naming the offending field rather than letting a raw Postgres foreign-key violation surface — verified manually with a nonexistent `departmentId`. `UpdateEmployeeDto.status` deliberately excludes `TERMINATED` (via `@IsIn` against the other four `EmployeeStatus` values) — that transition is only reachable through `DELETE /employees/:id`, which also stamps `terminationDate`, keeping status and termination date from ever going out of sync. `employeeCode` is immutable after creation (not present in `UpdateEmployeeDto`). No `User` row is ever created as a side effect of employee create/update, per the hard requirement. List/detail responses include minimal nested `department`/`designation`/`workLocation` objects (id + name/title + code) to save API consumers a round trip.
  - **Consolidated a small duplication while wiring this unit**: `apps/api/src/auth/auth.controller.ts` had a private `contextFromRequest()` helper; since 4 new controllers now need the identical IP/user-agent extraction, it was extracted to `apps/api/src/common/request-context.util.ts` (`getRequestContext`), and `auth.controller.ts`/`auth.types.ts` were updated to re-use/re-export it instead of keeping a duplicate.
  - **New shared `apps/api/src/common/` utilities** (justified by 4x reuse within this single unit): `PaginationQueryDto` (page ≥1 default 1, limit 1–100 default 20, optional `search`), `paginate()`/`paginationSkip()` helpers (consistent `{ data, meta: { page, limit, total, totalPages } }` envelope), `ParseCuidPipe` (rejects malformed `:id` params with a clean `400` before even hitting the database), `isUniqueConstraintError`/`isForeignKeyConstraintError`/`isRecordNotFoundError` (Prisma `P2002`/`P2003`/`P2025` detection, used to turn raw DB constraint violations into clean `409`/`400` responses instead of leaking Prisma internals), and `toJsonSnapshot()` (normalizes a Prisma model — which contains `Date` objects — into a JSON-safe value before it goes into an audit log's `Json` column; this exact `exactOptionalPropertyTypes` + Prisma-generated-type interaction bit both `AuditService` in Unit 3, now fixed in passing, and `EmployeesService`'s create/update `data` objects in this unit — see open questions for the general pattern).
  - Verified end-to-end against the real `recafco_hrms_dev` database: full install/generate/typecheck(×2)/build/root-typecheck suite passed; started the API, confirmed `/health` and `/health/db` still 200; created a department/designation/work location/employee through the real HTTP API as the bootstrapped super admin, confirmed list pagination + search, confirmed PATCH updates, confirmed `DELETE` soft-deactivates (row stays, `isActive`/`status` flips) rather than removing rows, confirmed invalid latitude/longitude (200/−400) is rejected with a clean `400` and a valid one succeeds, confirmed an employee created with a bogus `departmentId` is rejected with `400` and one with real FK ids succeeds and returns nested relation data + `fullName`, confirmed an anonymous request is rejected `401` and a real-but-low-privilege `EMPLOYEE`-role test user is rejected `403` on both a `departments.create` and an `employees.read` attempt, and confirmed via direct `psql` query that every create/update/deactivate/terminate action produced exactly the expected `audit_logs` row. **All test/verification data (the test department, designation, work location, employee, and the temporary low-privilege test user) was deleted afterward** — confirmed via `psql` that `employees`/`departments`/`designations`/`work_locations` are empty again and `users` contains only the one legitimate `superadmin` bootstrap account. Cleanly stopped the verification server afterward (again had to explicitly `Stop-Process` the two child PIDs — the same `TaskStop`-doesn't-kill-grandchildren caveat noted in Units 2 and 3) and confirmed port 4000 was released; did not touch any unrelated Node process.

## In Progress

- Finalizing MVP requirements and implementation order.
- Confirming real punching device brands/models and integration methods.
- Confirming company attendance/payroll policies.

## Next Up

Recommended first implementation units:

1. ~~Initialize pnpm monorepo.~~ Done.
2. ~~Add Next.js web app, NestJS API, React Native mobile app (folders scaffolded).~~
3. ~~Add shared package with enums/permissions.~~ Done (`packages/shared`).
4. ~~Add database package with Prisma/PostgreSQL.~~ Done — see Unit 1 above.
5. ~~Apply Prisma migration against a real local PostgreSQL database.~~ Done — see Unit 1.1 above (migration `20260714054603_init`).
6. ~~NestJS API foundation + database connection.~~ Done — see Unit 2 above.
7. ~~Auth/RBAC foundation.~~ Done — see Unit 3 above.
8. ~~Employee/Department/Designation/Work Location API foundation.~~ Done — see Unit 4 above.
9. **Unit 5 — Attendance Device Registry API foundation (recommended next unit).**
10. Implement shift service/API layer on top of the Unit 1 schema.
11. Implement attendance raw punch validation engine.

## Open Questions

### Company Policy Questions

- What is the official company timezone for attendance calculation?
- What is the standard work week and weekend policy?
- What are the shift types currently used?
- Are night shifts required?
- How should attendance date be calculated for overnight shifts?
- What are the late grace rules?
- What are the early leave rules?
- How is overtime calculated?
- Is break time tracked?
- Are lunch breaks auto-deducted or punched?
- What is the allowed radius for each office/site?
- Which employees are allowed to use mobile punching?
- Which employees must use biometric/device punching only?
- Are mobile punches allowed from all locations or only selected locations?
- Is selfie required for all mobile punches or only project sites?
- Is Wi-Fi validation required in office/factory?
- Is QR/site code required for project sites?
- What is the approval chain for missed punch correction?
- Who can approve payroll-locked corrections?
- How long should raw punch records be retained?
- What is the current payroll export format?

### Unit 1 (Database Schema) Open Questions

- `WorkLocation.timezone` defaults to `"UTC"` as a neutral placeholder until company timezone policy is confirmed (see company policy questions above). Attendance-date calculation logic must not hardcode a timezone until this is resolved.
- `Shift` start/end are stored as `startTimeMinutes`/`endTimeMinutes` (minutes from midnight) plus `isOvernight`, `gracePeriodMinutes`, `breakMinutes` rather than fixed business rules, since grace/overtime/break policy is still an open company-policy question. The validation/summary engine must treat these as configurable inputs, not hardcode behavior.
- `AttendanceCorrection.requestedByUserId`, `approvedByUserId`, and `AuditLog.actorUserId` are plain string fields (not foreign keys) because the User/auth model does not exist yet (planned for the auth/RBAC foundation unit). These should become real relations once that model lands — decide then whether to backfill a migration or leave as loose references.
- `AttendancePayrollLock` is modeled as a single global period lock (`periodStart`/`periodEnd`, no location/department scoping). Confirm this matches actual payroll closing policy (company-wide close vs. per-site close) before the monthly closing unit is built.
- Packages/shared's `AttendanceSourceType` and `PunchValidationStatus` enums had drifted from the source/status lists in `architecture.md` (e.g. `MANUAL_HR`/`SUPERVISOR_CORRECTION` instead of `MANUAL_CORRECTION`/`IMPORT`/`FUTURE_INTEGRATION`; missing `REJECTED_POLICY_VIOLATION`). Corrected in this unit to match `architecture.md` since no other code referenced the old values yet — confirm no other undocumented consumer expected the old names.

### Unit 2 (NestJS API Foundation) Open Questions

- `packages/shared` still has the same `"type": "module"` + raw-`.ts`-`main` packaging as `@recafco/db` had before this unit's fix. It isn't consumed by `apps/api` yet, so it was left alone, but it must get the same CommonJS-build treatment (`tsconfig.build.json`, compiled `dist/` output, `main`/`types` pointing at `dist`) before Unit 3 (Auth/RBAC) or any other CommonJS app tries to `import` it — otherwise it will hit the exact same `MODULE_NOT_FOUND` failure `@recafco/db` did.
- Env validation (`apps/api/src/config/env.schema.ts`) is a small local `zod` schema inside `apps/api`, not a shared `packages/config` module, even though `architecture.md` describes `packages/config` as eventually owning "Environment variable schema helpers." Revisit once `apps/web` or `apps/mobile` also need typed env validation — extract a shared helper then rather than guessing its shape now.
- `apps/api/nest-cli.json` has `"deleteOutDir": false` (see Unit 2 note above on the watch-mode race this fixed). If a future change re-enables it for a "clean build" reason, retest `nest start --watch` from a cold `dist/`-less state before relying on it, since a clean rebuild reproduced the crash (this wasn't just a stale-cache fluke).
- CORS is currently hardcoded to `http://localhost:3000` and `http://localhost:19006` in `main.ts`. This will need to become environment-driven (or otherwise configurable) once a real staging/production web origin exists — do not just widen it to a wildcard.

### Unit 3 (Auth/RBAC Foundation) Open Questions

- **The role → permission mapping in `apps/api/src/auth/constants/rbac.constants.ts` is a provisional default**, not a confirmed HR/security policy decision. In particular: should `HR_ADMIN` really lack `attendance.payroll.lock`/`unlock` (currently only `HR_MANAGER`+ has it)? Should `SUPERVISOR` really have `attendance.correction.approve`, or should first-level approval sit only with `DEPARTMENT_MANAGER`? Confirm against the real approval chain before this becomes load-bearing for actual payroll decisions.
- `AttendancePayrollLock.lockedByUserId`/`reopenedByUserId` were **not** converted to `User` relations in this unit (only the 3 fields the task explicitly named were). Revisit alongside the monthly payroll closing unit — converting them then is low-risk since that table is still empty.
- `packages/shared`'s `UserRole` enum (`packages/shared/src/enums/roles.ts`) already lists the same 9 role codes used here, but Auth code does **not** import `@recafco/shared` — the codes were duplicated as plain string literals in `rbac.constants.ts` instead, specifically to avoid triggering the same raw-`.ts`-`main`/`"type":"module"` packaging problem in a second package (see Unit 2's open question, still unresolved for `packages/shared`). Once `packages/shared` gets the same CommonJS-build treatment `@recafco/db` got, consider having `SYSTEM_ROLES` derive from `UserRole` instead of duplicating the list.
- No rate-limiting/throttling was added to `/auth/login` (or any endpoint) in this unit, even though `code-standards.md` calls for rate-limiting sensitive endpoints. The account-lockout mechanism (5 attempts / 15 min) covers targeted brute force against one account, but not distributed/low-and-slow attempts across many accounts or plain request flooding. Deliberately deferred rather than bolting on a throttler module mid-unit — flag as a small, separate follow-up unit (likely once Redis is introduced, per the roadmap, for a shared rate-limit store across multiple API instances).
- `User.username` is required + unique; `email` is optional + unique. Confirm this matches how HR actually provisions accounts (e.g., is every internal user guaranteed a username at creation time, or should email-first accounts be supported too?).
- The bootstrap script's 12-character minimum password check is a hardcoded constant (`MIN_BOOTSTRAP_PASSWORD_LENGTH`), not a configurable password policy. A real password-policy module (composition rules, rotation, etc.) is out of scope for this foundation unit but will be needed before HR/admin-facing user-creation endpoints ship.
- `GET /auth/me`'s `status`/`email`/`employeeId` fields are typed loosely (`string`/`string | null`) in `AuthService.getProfile`'s return type rather than reusing Prisma's generated `UserStatus` enum type — a minor looseness introduced to keep the method's return type independent of needing to import the enum; tighten if this becomes a shared DTO in Unit 4+.

### Unit 4 (Master Data API Foundation) Open Questions

- **Deactivating a department/designation/work location does not check whether any active employee still references it.** An HR admin can set a department `isActive: false` while employees are still assigned to it — the FK reference stays valid (rows are never deleted), so nothing breaks, but it may be surprising. No guard was added for this foundation unit (would need a policy decision: block deactivation, warn, or allow silently) — flag before this becomes a real HR workflow, not just an API.
- **The role → permission additions for the 13 new master-data permissions are provisional**, same caveat as Unit 3's original mapping: is `HR_ADMIN` really meant to lack `departments.disable`/`designations.disable`/`workLocations.disable` (reserved for `HR_MANAGER` here, mirroring the existing `users.disable` pattern)? Should `PAYROLL_OFFICER`/`AUDITOR`/`MANAGEMENT_VIEWER` really get blanket read access to all three master-data types? Confirm against real HR policy.
- **`architecture.md`'s "Suggested Permission Groups" list was already out of sync with the actually-implemented permission codes before this unit** (e.g. it lists `attendance.correct.approve.manager`/`.hr` where the code uses `attendance.correction.approve`; it has no `users.*` or `employees.disable` entries at all). This unit only appended the new department/designation/workLocation/employees.disable codes rather than reconciling the whole list — a full audit of `architecture.md`'s permission list against `rbac.constants.ts` is still owed.
- **`packages/shared`'s raw-`.ts`-`main` packaging problem (flagged in Units 2 and 3) is still unresolved** — this unit again avoided importing `@recafco/shared` from `apps/api` (e.g. could have reused its `EmployeeStatus`/`EmploymentType` enum shapes for DTOs, but didn't) to avoid re-triggering it. Fix it once, then both this and Unit 3's `SYSTEM_ROLES` duplication can be cleaned up together.
- **The `exactOptionalPropertyTypes` + Prisma "checked vs. unchecked" input-type ambiguity is now a recurring pattern** (hit in `AuditService` in Unit 3, and twice in `EmployeesService` in this unit) whenever a `create`/`update` call mixes scalar foreign-key fields (e.g. `departmentId`) with plain field assignments sourced from an optional-field DTO. The fix each time was the same: build an explicitly-typed intermediate `const data: Prisma.XUncheckedCreateInput = {...}` (or `UncheckedUpdateInput`) object, using `?? null` for nullable string fields and an `if (x !== undefined) data.y = x` guard for fields that have a schema default but aren't nullable. Worth extracting into a documented convention (or a small codegen/lint rule) once a 4th or 5th service hits it — not urgent enough to abstract yet.
- **Prisma's non-interactive `migrate dev` refusal (see Unit 4 completed-work note above) will recur** any time a schema change would normally trigger a warning prompt (new unique constraint on a column that could theoretically have duplicates, some column-type narrowing, etc.), even against a database that is provably empty. The `migrate diff --from-url ... --script` → hand-built migration folder → `migrate deploy` sequence is the known-working non-interactive path; consider documenting it as a standing runbook step rather than rediscovering it per-incident.
- **`WorkLocation.geofenceRadiusMeters`'s new upper bound (5000m) is a data-hygiene sanity ceiling, not a policy decision** — the real per-site-type allowed-radius policy (office vs. factory vs. project site) is still an open company-policy question from Unit 1, unchanged by this unit.

### Device Integration Questions

- What punching device brands/models are installed?
- Do devices support API, SDK, database sync, or CSV export?
- Are devices connected to LAN?
- Do devices store employee code matching HR employee ID?
- Do devices provide punch type IN/OUT, or only timestamp?
- How often should logs sync?
- Is there an existing database from the current device software?

### Deployment Questions

- Will production run on Linux server or Windows server?
- Is Docker allowed?
- Is the system LAN-only?
- Is VPN access required for managers/HR?
- What backup location is available?
- Is a standby server available?
- What uptime target should be promised internally?

## Architecture Decisions

### Decision: Use monorepo

Use pnpm workspace monorepo with `apps/web`, `apps/api`, `apps/mobile`, `packages/db`, `packages/shared`, and `packages/config`.

Reason: Shared HR statuses, permissions, validation schemas, and API types reduce mismatch across web, mobile, and backend.

### Decision: Use central attendance engine

All punch sources must flow into one raw punch table and one validation engine.

Reason: Employees may punch in by mobile and punch out by office device, or vice versa. Payroll-safe calculation requires one source of truth.

### Decision: Separate raw punches from summaries

Raw punches are immutable event records. Daily summaries are derived records.

Reason: Prevent salary disputes, support recalculation, preserve evidence, and improve auditability.

### Decision: Payroll closing lock

Monthly attendance summaries must be locked before payroll export.

Reason: Prevent silent changes after payroll processing.

### Decision: React Native mobile app

Use React Native for Android and iOS.

Reason: One TypeScript ecosystem with Next.js and NestJS, faster development, shared types, and sufficient support for GPS, camera, push notification, secure storage, and device binding.

### Decision: PostgreSQL as source of truth

Use PostgreSQL for HRMS data.

Reason: Attendance, employee, leave, approvals, and payroll support are relational and audit-heavy.

### Decision: Redis/BullMQ for heavy work

Use background jobs for reports, device imports, notifications, recalculations where needed.

Reason: Punch-in/out must remain fast and reliable.

### Decision: Prisma 6.19.3 (not the 7.x line) for `@recafco/db`

Pinned `prisma`/`@prisma/client` to `6.19.3` even though `7.x` is the current latest major on npm.

Reason: Prisma 7 changes the client generator (`prisma-client` vs. `prisma-client-js`), generally requires an explicit driver adapter (e.g. `@prisma/adapter-pg`) and a `prisma.config.ts`, and is ESM-only output. That's a bigger architectural surface than this foundation unit needs, and it can't be fully verified here without a live Postgres connection. Revisit the major-version choice as a deliberate decision (not a side effect) when the API app actually wires up the database connection.

### Decision: Device import idempotency via compound unique constraint

`AttendanceRawPunch` has `@@unique([attendanceDeviceId, sourceId])`.

Reason: `code-standards.md` requires unique constraints for device import deduplication. Postgres treats each `NULL` in a unique index as distinct, so mobile/web punches (`attendanceDeviceId` null) never collide with each other, while device-imported punches from the same device with the same external log id are rejected as duplicates at the database level, independent of the validation engine's own duplicate-detection logic.

### Decision: Root `.env` is the single source of truth for `DATABASE_URL`

`packages/db` does not duplicate a real `.env`; only `packages/db/.env.example` was added as a template, since Prisma CLI resolves `.env` relative to its own working directory, not the repo root, when run via `pnpm --filter`.

Reason: Avoid two copies of the same secret drifting out of sync. If `pnpm --filter @recafco/db db:generate/db:migrate/db:studio` needs `DATABASE_URL` locally, copy the root `.env` value into a new `packages/db/.env` (gitignored, not committed).

### Decision: `@recafco/db` (and future workspace libraries consumed by `apps/api`) must ship a real CommonJS build

Changed `packages/db` from `"type": "module"` + a `main` pointing directly at TypeScript source, to a proper `tsc`-compiled CommonJS `dist/` output.

Reason: `apps/api` is a NestJS app compiled with `tsc` to CommonJS and run with plain `node dist/main.js` in production (and via `nest start --watch` in dev, which also runs compiled JS, not `ts-node`). A CommonJS `require()` cannot load a raw `.ts` file. This wasn't visible in Unit 1 because nothing outside `packages/db` itself was importing it yet. `packages/shared` has the same latent problem and needs the identical fix before anything CommonJS-based imports it (see Unit 2 open questions).

### Decision: `DatabaseModule` is `@Global()`, wraps the existing `@recafco/db` singleton, and never throws on startup

`DatabaseService.onModuleInit()` calls `prisma.$connect()` but only logs a warning if it fails; it does not rethrow.

Reason: The hard requirement is that `GET /health` must work even if the database is down. If a failed `$connect()` threw during `onModuleInit`, Nest would abort the entire bootstrap and no endpoint — including `/health` — would ever become reachable. Swallowing the connect error (and letting Prisma reconnect lazily on the next query, which is how `/health/db` observes real connectivity) keeps the liveness check independent of the readiness check, which is the standard health-check pattern. Marked `@Global()` since nearly every future domain module (employees, attendance, leave, etc.) will need database access, and re-importing `DatabaseModule` in every feature module would be pure boilerplate.

### Decision: env validation is local to `apps/api` for now, not in `packages/config`

Reason: `packages/config` is currently an empty folder with no package.json. Standing up a full shared env-schema package for a single `zod` object with three fields would be speculative infrastructure ahead of actual need. Revisit when a second app needs typed env validation (see open questions).

### Decision: `argon2` for password hashing (not `bcryptjs`)

Tested `argon2` directly on this Windows machine (a real hash/verify round-trip, not just `npm install` succeeding) before deciding — it installed via a prebuilt native binary with zero build-tool friction, so used it per the task's stated preference order.

Reason: argon2id is the stronger, more modern choice recommended by current password-hashing guidance, and there was no actual Windows compatibility problem to justify the bcryptjs fallback.

### Decision: refresh tokens are real JWTs, but the database (via a SHA-256 hash) is the actual source of truth

A refresh token is a signed JWT (`{ sub, jti }`, signed with `JWT_REFRESH_SECRET`), but its validity is decided by looking up `refresh_tokens.tokenHash` (a hash of the whole token string) in the database — not by trusting the JWT's own `exp` claim alone. Rotated on every use: the old row is marked `revokedAt`, a new row + token pair is issued.

Reason: The task's env-var design (`JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`) implies refresh tokens should be signed JWTs like access tokens, but a DB-backed opaque-credential model is what actually allows "verify hashed stored refresh token" (as the task's endpoint spec requires) and real revocation (logout, admin-forced logout later). Combining both — JWT signature as a second independent check, DB row as the authoritative one — gets the benefits of each without a real tradeoff. Raw tokens are never persisted, only their hash.

### Decision: access-token JWT payload embeds roles and permissions

`AccessTokenPayload` carries `roles: string[]` and `permissions: string[]` directly, so `PermissionsGuard` reads them from the verified JWT (via Passport's `JwtStrategy`) with no per-request database query.

Reason: Punch/attendance-adjacent endpoints must stay fast per `architecture.md`'s reliability requirements, and re-resolving roles→permissions via three-table joins on every guarded request would add avoidable latency at scale (2000+ employees). The tradeoff — a permission change doesn't take effect until the user's next token refresh (≤15 minutes by default) — is acceptable for an internal HRMS and is the standard JWT-RBAC pattern. `GET /auth/me` still does a live DB read, so a user (or support staff) can always see their *current* actual permissions on demand, independent of what's cached in their current access token.

### Decision: `Role`/`Permission` are database rows with a `code` string, not Prisma enums

Reason: The task modeled them as tables (with `isSystemRole`/`description` fields), which only makes sense if they're meant to be extensible at runtime (e.g., a future HR-admin "create custom role" screen) without requiring a schema migration for every new role or permission — unlike the fixed, code-defined enums used elsewhere in the schema (`EmployeeStatus`, `PunchType`, etc.) for values that are true closed sets.

### Decision: `DELETE /:id` means soft-deactivate/terminate everywhere, never a real row delete

All four new modules map the `DELETE` HTTP verb to setting `isActive: false` (departments/designations/work locations) or `status: TERMINATED` + `terminationDate` (employees) — the row is never removed from the table.

Reason: `code-standards.md` and this task both explicitly require never hard-deleting master data that may be linked to attendance/payroll history. Using the `DELETE` verb for a soft action (rather than inventing a separate `POST /:id/deactivate` route) was a deliberate reading of the task's own phrasing ("DELETE or deactivate endpoint") — one endpoint serves both the REST convention and the safety requirement.

### Decision: master-data field names follow the existing schema, not the task's prose

`Designation.title` (not "name"), `WorkLocation.geofenceRadiusMeters` (not "allowedRadiusMeters"), `Employee.hireDate` (not "joiningDate"), `Employee.firstName`/`lastName` (not a single "fullName" column).

Reason: All of these fields already existed from Unit 1 with different names than the task's prose used. Renaming a real, already-migrated column for a purely cosmetic reason isn't worth a migration or the churn of updating every reference to it; the task's intent (what the field represents) is satisfied either way. Where the mismatch is purely presentational (full name), the API response adds a derived field (`fullName`) instead of touching storage.

### Decision: foreign-key existence is checked in the service layer, not left to the database

`EmployeesService.assertReferencesExist()` looks up `departmentId`/`designationId`/`workLocationId` before every write and throws a named `400 Bad Request` if any doesn't exist, rather than letting an invalid ID reach Postgres and surface as a raw `P2003` foreign-key-violation error.

Reason: `code-standards.md` requires clean validation errors and forbids leaking internal details; a raw Prisma/Postgres constraint error is neither clean nor named per-field. The extra lookup queries are cheap relative to the write itself and only run on mutations (not reads), so the cost is proportionate to a payroll-adjacent write path, not the fast, high-volume punch path this doesn't touch.

## Session Notes

- Employee count corrected to 2000+ employees. Architecture and performance targets must be sized for 2000+ active employees, multi-office punching devices, and peak attendance windows.

- The system must be better than the current third-party ESS while staying safe.
- Current third-party system supports dashboard, leave, attendance request, geo punching, documents, payslip, and workflow requests.
- The new HRMS should not replace the current system immediately.
- Run parallel with the current system for at least 1–2 months before payroll dependency.
- Focus first on attendance accuracy, HR usability, mobile experience, and audit safety.
- Full payroll engine, recruitment, advanced appraisal, and AI face recognition are not first-version priorities.

- A real super admin account now exists in the local `recafco_hrms_dev` database (username from `apps/api/.env`'s `BOOTSTRAP_ADMIN_USERNAME`, currently `superadmin`) with `mustChangePassword: true`. There is no "change password" endpoint yet (out of scope for Unit 3) — needed before this account can be handed to an actual person.

- Unit 4 manual verification created (and then fully deleted) one department, one designation, one work location, one employee, and one temporary `EMPLOYEE`-role test user to exercise the new CRUD/permission/audit flows end-to-end. `recafco_hrms_dev` was confirmed empty of all of these afterward — `employees`/`departments`/`designations`/`work_locations` all have 0 rows, `users` has exactly the one `superadmin` bootstrap account. No demo data was left behind.
