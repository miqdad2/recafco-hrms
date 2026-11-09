#!/usr/bin/env node
/**
 * RECAFCO HRMS — safe, verified PostgreSQL backup (INCIDENT-02).
 *
 * Usage (from the repo root):
 *   node infrastructure/backups/backup-database.mjs --database recafco_hrms_dev
 *     [--expect-user postgres] [--expect-port 5432] [--out <dir outside the repo>]
 *
 * Connection: RECAFCO_BACKUP_DATABASE_URL if set, otherwise DATABASE_URL from the repo-root .env.
 * The URL's own database name is IGNORED — the target is always the explicit --database value.
 * The password is handed to pg_dump/psql through the PGPASSWORD environment variable of the child
 * process only: it is never put on a command line, printed, or written to disk by this script.
 *
 * Guarantees (each failure exits non-zero and leaves no "successful-looking" file behind):
 *   1. Identity check BEFORE dumping: SELECT current_database(), current_user,
 *      inet_server_addr(), inet_server_port() must match the explicit expectations.
 *   2. Timestamped file name; refuses to run if the file already exists (never overwrites).
 *   3. Custom-format pg_dump, written to a .partial file and only renamed when complete.
 *   4. Verification: pg_restore --list must parse the archive and pg_restore must fully decode
 *      every data block (to the null device — nothing is restored anywhere).
 *   5. SHA-256 sidecar file for later integrity checks.
 * The script is read-only towards the database: pg_dump takes a snapshot and modifies nothing.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PG_BIN = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\18\\bin';
const LOOPBACK = new Set(['127.0.0.1', '::1']);

function fail(message) {
  console.error(`BACKUP FAILED: ${message}`);
  process.exit(1);
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

function connectionUrl() {
  if (process.env.RECAFCO_BACKUP_DATABASE_URL) return new URL(process.env.RECAFCO_BACKUP_DATABASE_URL);
  const envFile = join(REPO_ROOT, '.env');
  if (!existsSync(envFile)) fail('no RECAFCO_BACKUP_DATABASE_URL and no repo-root .env');
  const line = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  if (!line) fail('DATABASE_URL not found in repo-root .env');
  return new URL(line.replace(/^\s*DATABASE_URL\s*=\s*/, '').replace(/^"(.*)"$/, '$1').trim());
}

function run(tool, args, env) {
  const result = spawnSync(join(PG_BIN, tool), args, { env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error) fail(`${tool} could not start: ${result.error.message}`);
  return result;
}

const database = arg('database');
if (!database || !/^[a-z0-9_]+$/.test(database)) fail('--database <name> is required (lowercase letters, digits, _)');
const expectUser = arg('expect-user', 'postgres');
const expectPort = Number(arg('expect-port', '5432'));
const outDir = resolve(arg('out', join(homedir(), 'Documents', 'recafco-backups', 'recafco_hrms', database)));

if (outDir.toLowerCase().startsWith(REPO_ROOT.toLowerCase())) fail(`output directory ${outDir} is inside the Git repository`);

const url = connectionUrl();
const childEnv = {
  ...process.env,
  PGHOST: url.hostname.replace(/^\[(.*)\]$/, '$1'),
  PGPORT: url.port || '5432',
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: database,
  PGCONNECT_TIMEOUT: '10',
};

// 1. Verify the real connection identity before touching anything.
const identity = run(
  'psql.exe',
  ['-X', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c',
    'SELECT current_database(), current_user, host(inet_server_addr()), inet_server_port()'],
  childEnv,
);
if (identity.status !== 0) fail(`identity query failed: ${identity.stderr.trim()}`);
const [actualDb, actualUser, actualAddr, actualPort] = identity.stdout.trim().split('|');
if (actualDb !== database) fail(`connected to "${actualDb}", expected "${database}"`);
if (actualUser !== expectUser) fail(`connected as "${actualUser}", expected "${expectUser}"`);
if (!LOOPBACK.has(actualAddr)) fail(`server address ${actualAddr} is not a local loopback address`);
if (Number(actualPort) !== expectPort) fail(`server port ${actualPort}, expected ${expectPort}`);
console.log(`identity verified: database=${actualDb} user=${actualUser} server=${actualAddr}:${actualPort}`);

// 2. Unique, never-overwritten target.
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const finalPath = join(outDir, `${database}-${stamp}.dump`);
const partialPath = `${finalPath}.partial`;
if (existsSync(finalPath) || existsSync(partialPath)) fail(`${finalPath} already exists — refusing to overwrite`);

// 3. Dump.
const dump = run('pg_dump.exe', ['--format=custom', '--no-password', `--file=${partialPath}`, database], childEnv);
if (dump.status !== 0) {
  rmSync(partialPath, { force: true });
  fail(`pg_dump exited ${dump.status}: ${dump.stderr.trim()}`);
}

// 4. Verify before declaring success.
const list = run('pg_restore.exe', ['--list', partialPath], childEnv);
const tocEntries = list.stdout.split(/\r?\n/).filter((l) => l && !l.startsWith(';')).length;
if (list.status !== 0 || tocEntries === 0) {
  rmSync(partialPath, { force: true });
  fail(`pg_restore --list could not read the archive: ${list.stderr.trim()}`);
}
const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
const decode = run('pg_restore.exe', ['--file', nullDevice, partialPath], childEnv);
if (decode.status !== 0) {
  rmSync(partialPath, { force: true });
  fail(`pg_restore could not decode the archive: ${decode.stderr.trim()}`);
}

renameSync(partialPath, finalPath);
const sha256 = createHash('sha256').update(readFileSync(finalPath)).digest('hex');
writeFileSync(`${finalPath}.sha256`, `${sha256}  ${finalPath.split(/[\\/]/).pop()}\n`, { flag: 'wx' });

console.log(`backup OK: ${finalPath}`);
console.log(`  size=${statSync(finalPath).size} bytes  toc_entries=${tocEntries}  sha256=${sha256}`);
