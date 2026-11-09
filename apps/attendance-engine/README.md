# recafco-attendance-engine

A Rust service that will become the high-performance attendance-processing engine for RECAFCO HRMS.

**Current scope (RUST-01):**
- health and readiness endpoints, configuration, structured logging, graceful shutdown;
- a **read-only**, lazily-connected PostgreSQL pool.

It performs no attendance processing, has no attendance endpoints, and is not connected to mobile or biometric punching. The NestJS API (`apps/api`) remains the only writer of official attendance.

Design, audit, and integration contract: [`docs/architecture/rust-attendance-engine.md`](../../docs/architecture/rust-attendance-engine.md).

## Prerequisites

- Rust via rustup. The compiler version is pinned in `rust-toolchain.toml` (1.99.1), and rustup installs it automatically on first use.
- On **Windows without Visual Studio Build Tools**, use the GNU host (`x86_64-pc-windows-gnu`) and always build through `scripts/cargo.sh` / `scripts/cargo.ps1`.
  - The wrapper points rustc at LLVM's `dlltool`, which comes from rustup's `llvm-tools` component and is installed automatically if missing.
  - It does this because the bundled GNU `dlltool` needs an assembler that isn't installed.
  - It changes nothing global.
  - On Linux, macOS, or Windows-MSVC the wrapper is a plain pass-through, so you can use `cargo` directly.

If `cargo` is not on your PATH (rustup was installed with `--no-modify-path`), the wrapper adds `%USERPROFILE%\.cargo\bin` for its own process only.

## Commands (run from `apps/attendance-engine`)

```bash
./scripts/cargo.sh fmt --all -- --check
./scripts/cargo.sh clippy --all-targets -- -D warnings
./scripts/cargo.sh test
./scripts/cargo.sh build --release
./scripts/cargo.sh run                     # dev server on 127.0.0.1:4100
```

PowerShell: replace `./scripts/cargo.sh` with `.\scripts\cargo.ps1`.

This crate is **not** a pnpm workspace package (it has no `package.json`), so `pnpm build`/`turbo` don't run it. Run the cargo commands above alongside the pnpm checks.

### Live database tests (opt-in)

```bash
ATTENDANCE_ENGINE_TEST_DATABASE_URL=postgresql://user:pw@localhost:5432/recafco_hrms_dev \
  ./scripts/cargo.sh test --test readiness_db_test -- --ignored
```

These tests only read. The single write attempt (a `CREATE TABLE` probe) runs in a transaction that is always rolled back, and PostgreSQL rejects it anyway with SQLSTATE `25006`.

Use a local development database only.

## Configuration

Only `apps/attendance-engine/.env` is loaded, by exact path. The monorepo root `.env` (which holds NestJS secrets) is never read.

Templates:
- [`.env.example`](.env.example) for development
- [`.env.production.example`](.env.production.example) for production (not deployed in RUST-01)

| Variable | Default | Rules |
| --- | --- | --- |
| `ATTENDANCE_ENGINE_ENV` | `development` | `development` \| `production` |
| `ATTENDANCE_ENGINE_HOST` | `127.0.0.1` | IP address |
| `ATTENDANCE_ENGINE_PORT` | `4100` | 1–65535 |
| `ATTENDANCE_ENGINE_DATABASE_URL` | unset | `postgres://` / `postgresql://`. **Required in production.** Never logged. |
| `ATTENDANCE_ENGINE_DB_MAX_CONNECTIONS` | `5` | 1–100 |
| `ATTENDANCE_ENGINE_DB_MIN_CONNECTIONS` | `0` | 0–100, ≤ max |
| `ATTENDANCE_ENGINE_DB_ACQUIRE_TIMEOUT_MS` | `3000` | 100–60000 |
| `ATTENDANCE_ENGINE_DB_STATEMENT_TIMEOUT_MS` | `5000` | 100–600000 |
| `ATTENDANCE_ENGINE_READINESS_TIMEOUT_MS` | `2000` | 100–30000 |
| `ATTENDANCE_ENGINE_REQUEST_TIMEOUT_MS` | `10000` | 100–300000 |
| `ATTENDANCE_ENGINE_SHUTDOWN_GRACE_MS` | `10000` | 0–120000 |
| `ATTENDANCE_ENGINE_LOG_FORMAT` | `json` | `json` \| `pretty` |
| `RUST_LOG` | `info` | tracing `EnvFilter` syntax. Use `tower_http=debug` for per-request logs. |

Exit codes:
- `2`: invalid or missing configuration (one structured JSON line on stderr, never containing secrets)
- `1`: runtime failure, e.g. the port is already in use
- `0`: clean shutdown

Prisma URLs often end in `?schema=public`. sqlx ignores that parameter (it logs a warning), so strip it from the engine's URL. The engine relies on PostgreSQL's default `search_path`, which is `public`.

## Endpoints

| Method | Path | 200 | Non-200 |
| --- | --- | --- | --- |
| GET | `/health` | `{"service":"recafco-attendance-engine","status":"ok","version":"0.1.0"}` | — (liveness only, never checks dependencies) |
| GET | `/ready` | `{"status":"ready","checks":{"database":{"status":"ok","read_only":true,"pool":{…}}}}` | `503`, with `checks.database.status` set to `not_configured`, `unreachable`, `timeout` or `not_read_only` |
| any | anything else | — | `404 {"error":{"code":"NOT_FOUND",…}}` |

## Database access is read-only, enforced twice

1. **In code:** every session is opened with `default_transaction_read_only=on` and a `statement_timeout`. `/ready` checks the setting on a live connection and reports `not_read_only` (503) if it isn't in effect.
2. **Operationally (recommended):** connect as a dedicated read-only role.
   - Create it only with DBA/IT approval; it's an open question in the tracker.
   - The engine itself never creates roles or runs migrations.

```sql
CREATE ROLE recafco_engine_ro LOGIN PASSWORD '<generated>';
GRANT CONNECT ON DATABASE recafco_hrms_dev TO recafco_engine_ro;
GRANT USAGE ON SCHEMA public TO recafco_engine_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO recafco_engine_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO recafco_engine_ro;
ALTER ROLE recafco_engine_ro SET default_transaction_read_only = on;
```

The Prisma schema in `packages/db` is the **only** schema authority. This crate has no migrations and must never get any. See the design doc §5 for how future SQL stays compatible with Prisma migrations.

## Future SQL queries

- Physical names come from Prisma.
  - Tables use their `@@map` names (`attendance_raw_punches`).
  - Columns keep their quoted camelCase field names (`"employeeId"`).
- Use explicit column lists.
- Before switching to `sqlx::query!`, enable the sqlx `macros` feature and commit `cargo sqlx prepare` offline data, so builds never need a live database.
