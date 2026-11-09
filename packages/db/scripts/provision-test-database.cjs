#!/usr/bin/env node
/**
 * RECAFCO HRMS — provision the isolated, least-privileged test database (INCIDENT-02).
 *
 * ADMIN TOOL, run manually and rarely. It is never invoked by automated tests, and the admin
 * credentials it needs are never stored by it.
 *
 *   ADMIN_DATABASE_URL=postgresql://<superuser>:<pw>@127.0.0.1:5432/postgres \
 *     node packages/db/scripts/provision-test-database.cjs --evidence-dir <folder outside the repo>
 *
 * Idempotent. Each step verifies its preconditions and stops (non-zero exit) on any surprise.
 *   1. Role `recafco_test`: LOGIN only — NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
 *      NOREPLICATION NOBYPASSRLS, no role memberships. A fresh random password is set on every
 *      run and written ONLY to apps/api/.env.test (git-ignored), never printed.
 *   2. Database `recafco_hrms_test` owned by `recafco_test`. A pre-existing test database owned by
 *      anyone else is RENAMED (never dropped) to `recafco_hrms_test_incident01_archive`.
 *      PUBLIC privileges on it are revoked.
 *   3. Marker table `test_guard.marker`, created AS `recafco_test`. The destructive-operation
 *      guard in apps/api/test/support refuses any database without it.
 *   4. `REVOKE CONNECT, TEMPORARY ON DATABASE recafco_hrms_dev FROM PUBLIC`. Superusers (the API's
 *      current dev login) bypass this. Only roles relying on PUBLIC lose access.
 *   5. pg_hba.conf: a role-scoped block placed before every existing rule. `recafco_test` may
 *      reach `recafco_hrms_test` over loopback; every other database rejects it. No other role's
 *      rules change. The original file is saved to --evidence-dir. The new file is validated with
 *      pg_hba_file_rules before pg_reload_conf(), and the original is restored on any failure.
 */
const { randomBytes, createHash } = require('node:crypto');
const { mkdirSync, writeFileSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { PrismaClient } = require('@prisma/client');

const TEST_DB = 'recafco_hrms_test';
const TEST_ROLE = 'recafco_test';
const ARCHIVE_DB = 'recafco_hrms_test_incident01_archive';
const DEV_DB = 'recafco_hrms_dev';
const MARKER_PURPOSE = 'RECAFCO_DISPOSABLE_TEST_DATABASE';
const HBA_BEGIN = '# >>> RECAFCO-INCIDENT-02 BEGIN: recafco_test may only reach recafco_hrms_test';
const HBA_END = '# <<< RECAFCO-INCIDENT-02 END';
const HBA_BLOCK = [
  HBA_BEGIN,
  `host    ${TEST_DB}    ${TEST_ROLE}    127.0.0.1/32    scram-sha-256`,
  `host    ${TEST_DB}    ${TEST_ROLE}    ::1/128         scram-sha-256`,
  `host    all    ${TEST_ROLE}    all    reject`,
  `local   all    ${TEST_ROLE}    reject`,
  HBA_END,
];
const REPO_ROOT = resolve(__dirname, '../../..');
const ENV_TEST_PATH = join(REPO_ROOT, 'apps', 'api', '.env.test');

function fail(message) {
  console.error(`PROVISIONING STOPPED: ${message}`);
  process.exit(1);
}
const log = (message) => console.log(`- ${message}`);

function urlFor(base, { user, password, database }) {
  const url = new URL(base);
  if (user) url.username = user;
  if (password) url.password = password;
  url.pathname = `/${database}`;
  url.search = '';
  return url.toString();
}

async function withClient(url, fn) {
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    return await fn(client);
  } finally {
    await client.$disconnect();
  }
}

/** Dollar-quoted SQL literal with a tag guaranteed not to occur in the value. */
function literal(value) {
  let tag = 'q';
  while (value.includes(`$${tag}$`)) tag += 'q';
  return `$${tag}$${value}$${tag}$`;
}

async function main() {
  const adminBase = process.env.ADMIN_DATABASE_URL;
  if (!adminBase) fail('ADMIN_DATABASE_URL is required');
  const evidenceIndex = process.argv.indexOf('--evidence-dir');
  const evidenceDir = evidenceIndex > -1 ? resolve(process.argv[evidenceIndex + 1]) : null;
  if (!evidenceDir || evidenceDir.toLowerCase().startsWith(REPO_ROOT.toLowerCase())) {
    fail('--evidence-dir <folder outside the repository> is required');
  }
  mkdirSync(evidenceDir, { recursive: true });

  const adminUrl = urlFor(adminBase, { database: 'postgres' });
  const password = randomBytes(24).toString('base64url');

  await withClient(adminUrl, async (admin) => {
    // 0. Admin identity.
    const [me] = await admin.$queryRawUnsafe(
      `SELECT current_user AS "user", (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super,
              host(inet_server_addr()) AS addr, inet_server_port() AS port`,
    );
    if (!me.super) fail(`admin connection user "${me.user}" is not a superuser`);
    if (!['127.0.0.1', '::1'].includes(me.addr)) fail(`server ${me.addr} is not local`);
    log(`admin identity verified: ${me.user}@${me.addr}:${me.port}`);

    // 1. Role.
    const roleExists = (await admin.$queryRawUnsafe(`SELECT 1 FROM pg_roles WHERE rolname = '${TEST_ROLE}'`)).length > 0;
    const attrs = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20';
    if (roleExists) {
      await admin.$executeRawUnsafe(`ALTER ROLE ${TEST_ROLE} ${attrs} PASSWORD ${literal(password)}`);
      log(`role ${TEST_ROLE} existed: attributes re-asserted, password rotated`);
    } else {
      await admin.$executeRawUnsafe(`CREATE ROLE ${TEST_ROLE} ${attrs} PASSWORD ${literal(password)}`);
      log(`role ${TEST_ROLE} created`);
    }
    const memberships = await admin.$queryRawUnsafe(
      `SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
       WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = '${TEST_ROLE}')`,
    );
    if (memberships.length > 0) fail(`${TEST_ROLE} is a member of ${memberships.map((m) => m.rolname).join(', ')}`);
    const [role] = await admin.$queryRawUnsafe(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = '${TEST_ROLE}'`,
    );
    if (Object.values(role).some(Boolean)) fail(`${TEST_ROLE} has an elevated attribute: ${JSON.stringify(role)}`);
    log('role has no elevated attributes and no memberships');

    // 2. Database.
    const [existing] = await admin.$queryRawUnsafe(
      `SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = '${TEST_DB}'`,
    );
    if (existing && existing.owner !== TEST_ROLE) {
      const archiveExists = (await admin.$queryRawUnsafe(`SELECT 1 FROM pg_database WHERE datname = '${ARCHIVE_DB}'`)).length > 0;
      if (archiveExists) fail(`${TEST_DB} is owned by ${existing.owner} and ${ARCHIVE_DB} already exists — resolve manually`);
      await admin.$executeRawUnsafe(`ALTER DATABASE ${TEST_DB} RENAME TO ${ARCHIVE_DB}`);
      await admin.$executeRawUnsafe(`REVOKE CONNECT, TEMPORARY ON DATABASE ${ARCHIVE_DB} FROM PUBLIC`);
      log(`old ${TEST_DB} (owner ${existing.owner}) renamed to ${ARCHIVE_DB} (not dropped); PUBLIC access revoked`);
    }
    if (!existing || existing.owner !== TEST_ROLE) {
      await admin.$executeRawUnsafe(`CREATE DATABASE ${TEST_DB} OWNER ${TEST_ROLE} TEMPLATE template0 ENCODING 'UTF8'`);
      log(`database ${TEST_DB} created, owner ${TEST_ROLE}`);
    } else {
      log(`database ${TEST_DB} already owned by ${TEST_ROLE}`);
    }
    await admin.$executeRawUnsafe(`REVOKE ALL ON DATABASE ${TEST_DB} FROM PUBLIC`);
    await admin.$executeRawUnsafe(`GRANT CONNECT, TEMPORARY ON DATABASE ${TEST_DB} TO ${TEST_ROLE}`);
    log(`PUBLIC privileges on ${TEST_DB} revoked`);

    // 4. Development database: remove the PUBLIC default CONNECT/TEMP grant.
    await admin.$executeRawUnsafe(`REVOKE CONNECT, TEMPORARY ON DATABASE ${DEV_DB} FROM PUBLIC`);
    log(`PUBLIC CONNECT/TEMPORARY on ${DEV_DB} revoked (superuser access unaffected)`);
  });

  // .env.test, written before the marker step so a failure below still leaves a usable password.
  const testUrl = urlFor(adminBase, { user: TEST_ROLE, password, database: TEST_DB }).replace('//localhost', '//127.0.0.1');
  writeFileSync(
    ENV_TEST_PATH,
    `# Generated by packages/db/scripts/provision-test-database.cjs — git-ignored, do not commit.\n` +
      `# Credentials of the least-privileged recafco_test role. Valid only for ${TEST_DB}.\n` +
      `TEST_DATABASE_URL=${testUrl}\n`,
  );
  log(`wrote ${ENV_TEST_PATH}`);

  // 3. Marker, created AS the test role (also proves the role can log in to its own database).
  await withClient(testUrl, async (tester) => {
    const [who] = await tester.$queryRawUnsafe('SELECT current_database() AS db, current_user AS "user"');
    if (who.db !== TEST_DB || who.user !== TEST_ROLE) fail(`marker connection is ${who.user}@${who.db}`);
    await tester.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS test_guard');
    await tester.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS test_guard.marker (
         id integer PRIMARY KEY CHECK (id = 1),
         purpose text NOT NULL,
         database_name text NOT NULL,
         created_at timestamptz NOT NULL DEFAULT now())`,
    );
    await tester.$executeRawUnsafe(
      `INSERT INTO test_guard.marker (id, purpose, database_name) VALUES (1, '${MARKER_PURPOSE}', '${TEST_DB}') ON CONFLICT (id) DO NOTHING`,
    );
    log('marker test_guard.marker present');
  });

  // 5. pg_hba.conf.
  await withClient(adminUrl, async (admin) => {
    const [{ hba_file: hbaFile }] = await admin.$queryRawUnsafe('SHOW hba_file');
    const [{ content: original }] = await admin.$queryRawUnsafe(`SELECT pg_read_file(${literal(hbaFile)}) AS content`);
    if (original.includes(HBA_BEGIN)) {
      log('pg_hba.conf already contains the RECAFCO-INCIDENT-02 block');
      return;
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const backupPath = join(evidenceDir, `pg_hba.conf.original-${stamp}`);
    if (existsSync(backupPath)) fail(`${backupPath} exists`);
    writeFileSync(backupPath, original, { flag: 'wx' });
    writeFileSync(`${backupPath}.sha256`, `${createHash('sha256').update(original).digest('hex')}\n`, { flag: 'wx' });
    log(`original pg_hba.conf saved to ${backupPath}`);

    const lines = original.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    const firstRule = lines.findIndex((l) => l.trim() !== '' && !l.trim().startsWith('#'));
    if (firstRule < 0) fail('pg_hba.conf has no active rules — refusing to edit');
    const updated = [...lines.slice(0, firstRule), ...HBA_BLOCK, '', ...lines.slice(firstRule)];

    const writeLines = async (arr) => {
      const values = arr.map((l) => (l === '' ? 'NULL' : literal(l))).join(',');
      await admin.$executeRawUnsafe(
        `COPY (SELECT line FROM unnest(ARRAY[${values}]::text[]) WITH ORDINALITY AS t(line, n) ORDER BY n)
         TO ${literal(hbaFile)} WITH (FORMAT csv, DELIMITER E'\\x02', QUOTE E'\\x01', NULL '')`,
      );
    };
    const restore = async (reason) => {
      await writeLines(lines);
      console.error(`pg_hba.conf restored to its original rules (${reason}); configuration NOT reloaded`);
      fail(reason);
    };

    await writeLines(updated);
    const [{ content: written }] = await admin.$queryRawUnsafe(`SELECT pg_read_file(${literal(hbaFile)}) AS content`);
    // COPY TO terminates rows with \r\n on Windows and \n elsewhere; compare line content only.
    if (written.replace(/\r\n/g, '\n') !== `${updated.join('\n')}\n`) {
      await restore('written pg_hba.conf does not match the intended content');
    }
    const rules = await admin.$queryRawUnsafe(
      'SELECT line_number, type, database, user_name, auth_method, error FROM pg_hba_file_rules ORDER BY line_number',
    );
    if (rules.some((r) => r.error)) await restore(`pg_hba.conf parse error: ${rules.find((r) => r.error).error}`);
    const ours = rules.filter((r) => Array.isArray(r.user_name) && r.user_name.includes(TEST_ROLE));
    const firstOther = rules.find((r) => !(Array.isArray(r.user_name) && r.user_name.includes(TEST_ROLE)));
    if (ours.length !== 4 || ours.some((r) => r.line_number > firstOther.line_number)) {
      await restore('recafco_test rules are not all placed before the existing rules');
    }
    const [{ reloaded }] = await admin.$queryRawUnsafe('SELECT pg_reload_conf() AS reloaded');
    if (!reloaded) fail('pg_reload_conf() returned false');
    log(`pg_hba.conf updated (4 role-scoped rules before line ${firstOther.line_number}) and configuration reloaded`);
  });

  console.log('provisioning complete');
}

main().catch((error) => fail(error.message.split('\n').slice(-3).join(' ')));
