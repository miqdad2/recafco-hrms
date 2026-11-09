# INCIDENT-01 / INCIDENT-02 — Development database truncated by an automated test run

| | |
| --- | --- |
| Severity | Data loss, local development database only (`recafco_hrms_dev`). No production system was involved. |
| Detected | 2026-11-08, during unit TIME-01 |
| First destructive commit | 2026-11-08 12:33:43 +03 (WAL-confirmed); repeated in a second run at ~12:38 |
| Status | Root cause fixed and verified (INCIDENT-02). **Historical dev data is not recoverable.** RBAC + a temporary `superadmin` were rebuilt via the existing bootstrap. Master data must be re-entered by the owner. |
| Evidence archive (outside Git) | `C:\Users\5857\Documents\recafco-incidents\INCIDENT-01-20261108-124520\` (dumps, WAL, logs, git state, SHA256SUMS) and `...\INCIDENT-02-20261108-130608\` (original `pg_hba.conf`) |

## What happened

TIME-01 introduced the first Jest integration suite for `apps/api`. Its `beforeEach` emptied every application table (`TRUNCATE ... CASCADE`, excluding `_prisma_migrations`), intending to do so in `recafco_hrms_test`. Every statement actually ran against `recafco_hrms_dev`.

## Root cause (reproduced with Jest's real environment class, read-only)

1. `test/support/global-setup.ts` imported `@recafco/db` in the outer Jest process. `packages/db/dist/client.js` ran `globalThis.__recafcoPrisma ?? new PrismaClient()` **at import time** and cached the client on `globalThis`.
2. No `DATABASE_URL` was set in that process. The generated Prisma client loads `packages/db/.env` (`schemaEnvPath`), so the cached client was bound to `recafco_hrms_dev`.
3. `maxWorkers: 1` makes Jest run test files in band, in the same process. `jest-environment-node` copies the outer `globalThis` properties into every test sandbox, so the dev-bound client leaked in.
4. `setup-env.ts` set the sandbox's `DATABASE_URL` to the test database. The guard checked only that **text**, so it passed. Meanwhile `client.js` reused the leaked dev client.

## Recoverability (final)

- PostgreSQL: `archive_mode=off`, no base backup, `wal_keep_size=0`. The available WAL (from 2026-11-05) contains no pre-incident dev rows.
- Windows Volume Shadow Copy: `vssadmin list shadows` returned "No items found that satisfy the query." File History isn't configured.
- No `recafco_hrms` dump existed anywhere on the machine.
- Server statistics since 2026-10-14 show no user-originated writes to dev, so everything lost predates 2026-10-14.
- **Lost:** all hand-entered dev records (employees, users, work locations, devices, mobile registrations, punches, summaries, corrections, payroll locks, audit history). **Rebuildable from code:** roles, permissions, role mappings, a super-admin (via the bootstrap).

## Permanent fixes (INCIDENT-02)

| Layer | Protection |
| --- | --- |
| Prisma client | `@recafco/db` constructs nothing at import and never uses `globalThis`. `createPrismaClient(url)` binds an explicit `datasourceUrl`. `getSharedPrismaClient()` is lazy and **throws under Jest**. |
| Dependency injection | `DatabaseService` receives its client via the `PRISMA_CLIENT` token. Tests always override it with the explicit test client. |
| Credentials | Tests read only `apps/api/.env.test` (git-ignored), holding the `recafco_test` role. They never read the root `.env` or `packages/db/.env`. JWT secrets in tests are test-only constants. |
| Database role | `recafco_test`: LOGIN only (no SUPERUSER/CREATEDB/CREATEROLE/INHERIT/REPLICATION/BYPASSRLS), no memberships, owner of `recafco_hrms_test` only. |
| Database privileges | `REVOKE ALL ON DATABASE recafco_hrms_test FROM PUBLIC`. `REVOKE CONNECT, TEMPORARY ON DATABASE recafco_hrms_dev FROM PUBLIC` (superuser access is unaffected). The pre-incident test DB was renamed, not dropped, to `recafco_hrms_test_incident01_archive`, with PUBLIC revoked. |
| Authentication | Role-scoped `pg_hba.conf` block before all existing rules: `recafco_test` may reach `recafco_hrms_test` over loopback; every other database rejects it. No other role's rules changed. |
| Destructive guard | `apps/api/test/support/database-guard.ts`. It requires `RECAFCO_TEST_DB_RESET=ALLOW_TRUNCATE_recafco_hrms_test`, then verifies the live connection inside the **same transaction** as the TRUNCATE: `current_database()`, `current_user`/`session_user`, `inet_server_addr()` (loopback), `inet_server_port()`, and the `test_guard.marker` row (whose `database_name` must match). Any failure refuses. |
| Regression tests | `apps/api/test/safety/database-isolation.spec.ts` (18 tests, non-destructive). |
| Backups | `infrastructure/backups/backup-database.mjs`: identity-verified, timestamped, never-overwrite, `pg_restore`-verified, SHA-256 sidecar, stored outside Git. |

Provisioning tool (admin, idempotent): `packages/db/scripts/provision-test-database.cjs`.

## Rules going forward

- Take a verified dev backup before any unit that runs migrations or test suites.
- Destructive test suites run only with the explicit reset flag, and only after `pnpm --filter @recafco/api test:safety` passes.
- Never point any test, script or tool at a database by URL text alone. Verify the live identity.
