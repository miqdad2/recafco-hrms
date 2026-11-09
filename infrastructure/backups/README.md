# Database backups

The policy below was introduced after INCIDENT-01, when automated tests truncated the development database and no backup existed. See `docs/incidents/INCIDENT-01-dev-database-truncation.md`.

## Policy

1. **Before** any unit that runs migrations, bootstrap scripts or test suites against a local database, take a verified backup of `recafco_hrms_dev`.
2. Backups live **outside Git**. The default is `%USERPROFILE%\Documents\recafco-backups\recafco_hrms\<database>\`. The script refuses an output folder inside the repository.
3. Backups are never overwritten. Every file is timestamped, and the script refuses to run if the target already exists.
4. A backup only counts once it has been verified: `pg_restore --list` parses it and `pg_restore` fully decodes it.
5. Dumps contain personal data and password hashes. Treat them as confidential. Never attach them to tickets or chats.

## Usage

```bash
node infrastructure/backups/backup-database.mjs --database recafco_hrms_dev
#   optional: --expect-user postgres --expect-port 5432 --out <folder outside the repo>
```

The connection comes from `RECAFCO_BACKUP_DATABASE_URL`, falling back to `DATABASE_URL` in the repo-root `.env`. The URL's own database name is ignored, and the explicit `--database` is used. The password is passed to `pg_dump` via `PGPASSWORD` only, never on the command line.

Before dumping, the script verifies `current_database()`, `current_user`, `inet_server_addr()` (loopback only) and `inet_server_port()`. On any mismatch or error it exits non-zero, without keeping a partial file.

## Restoring (manual, deliberate)

Always restore into a **new** database first and inspect it before replacing anything:

```bash
createdb -h 127.0.0.1 -U postgres recafco_hrms_restore_check
pg_restore -h 127.0.0.1 -U postgres -d recafco_hrms_restore_check --no-owner <file>.dump
```
