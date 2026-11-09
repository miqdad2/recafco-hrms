/**
 * Destructive-operation guard for the API test suites (INCIDENT-02).
 *
 * INCIDENT-01 happened because the old guard trusted the TEXT of DATABASE_URL while the Prisma
 * client was actually connected to recafco_hrms_dev. This guard trusts only what the live
 * connection itself reports, and it fails closed on any doubt.
 *
 * Every destructive operation must go through `runDestructiveTestOperation`, which runs the
 * verification and the operation inside ONE interactive transaction — i.e. on the same physical
 * connection — so the database that was verified is exactly the database that is modified.
 */
import type { PrismaClient } from '@recafco/db';

export const EXPECTED_TEST_DATABASE = {
  database: 'recafco_hrms_test',
  role: 'recafco_test',
  port: 5432,
  hosts: ['127.0.0.1', '::1'],
} as const;

export const TEST_MARKER_PURPOSE = 'RECAFCO_DISPOSABLE_TEST_DATABASE';
/** Destructive cleanup additionally requires this env var to equal `ALLOW_TRUNCATE_<database>`. */
export const RESET_AUTHORIZATION_ENV = 'RECAFCO_TEST_DB_RESET';

export interface ExpectedTestDatabase {
  database: string;
  role: string;
  port: number;
  hosts: readonly string[];
}

/** Minimal surface shared by PrismaClient and an interactive-transaction client (and test fakes). */
export interface RawQueryable {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

export class TestDatabaseGuardError extends Error {
  constructor(message: string) {
    super(`TEST DATABASE GUARD REFUSED: ${message}`);
    this.name = 'TestDatabaseGuardError';
  }
}

export interface VerifiedTestDatabase {
  database: string;
  role: string;
  serverAddress: string;
  serverPort: number;
}

interface IdentityRow {
  database: string;
  current_role: string;
  session_role: string;
  server_address: string | null;
  server_port: number | null;
}

interface MarkerRow {
  purpose: string;
  database_name: string;
}

/** Non-destructive: verifies who/where the live connection is, plus the test-only marker. */
export async function verifyTestDatabaseConnection(
  db: RawQueryable,
  expected: ExpectedTestDatabase = EXPECTED_TEST_DATABASE,
): Promise<VerifiedTestDatabase> {
  let rows: IdentityRow[];
  try {
    rows = await db.$queryRawUnsafe<IdentityRow[]>(
      `SELECT current_database() AS database, current_user AS current_role, session_user AS session_role,
              host(inet_server_addr()) AS server_address, inet_server_port() AS server_port`,
    );
  } catch (error) {
    throw new TestDatabaseGuardError(`identity query failed (${error instanceof Error ? error.message.split('\n')[0] : 'unknown'})`);
  }
  const identity = rows[0];
  if (!identity) {
    throw new TestDatabaseGuardError('identity query returned no row');
  }
  if (identity.database !== expected.database || !identity.database.endsWith('_test')) {
    throw new TestDatabaseGuardError(`connected to database "${identity.database}", expected "${expected.database}"`);
  }
  if (identity.current_role !== expected.role || identity.session_role !== expected.role) {
    throw new TestDatabaseGuardError(
      `connected as "${identity.session_role}"/"${identity.current_role}", expected role "${expected.role}"`,
    );
  }
  if (!identity.server_address || !expected.hosts.includes(identity.server_address)) {
    throw new TestDatabaseGuardError(`server address "${identity.server_address}" is not an expected local host`);
  }
  if (Number(identity.server_port) !== expected.port) {
    throw new TestDatabaseGuardError(`server port ${identity.server_port}, expected ${expected.port}`);
  }

  let markers: MarkerRow[];
  try {
    markers = await db.$queryRawUnsafe<MarkerRow[]>(
      'SELECT purpose, database_name FROM test_guard.marker WHERE id = 1',
    );
  } catch {
    throw new TestDatabaseGuardError('test-only marker table test_guard.marker is missing');
  }
  const marker = markers[0];
  if (!marker || marker.purpose !== TEST_MARKER_PURPOSE) {
    throw new TestDatabaseGuardError('test-only marker row is missing or has the wrong purpose');
  }
  // Defends against a test database's contents having been restored into another database.
  if (marker.database_name !== identity.database) {
    throw new TestDatabaseGuardError(
      `marker belongs to "${marker.database_name}" but the connection is to "${identity.database}"`,
    );
  }

  return {
    database: identity.database,
    role: identity.current_role,
    serverAddress: identity.server_address,
    serverPort: Number(identity.server_port),
  };
}

/** Non-destructive check of the explicit cleanup authorization flag. */
export function assertResetAuthorized(
  env: Record<string, string | undefined> = process.env,
  expected: ExpectedTestDatabase = EXPECTED_TEST_DATABASE,
): void {
  const required = `ALLOW_TRUNCATE_${expected.database}`;
  if (env[RESET_AUTHORIZATION_ENV] !== required) {
    throw new TestDatabaseGuardError(`${RESET_AUTHORIZATION_ENV} must be set to "${required}" to allow destructive test cleanup`);
  }
}

/**
 * The ONLY way the test harness may run a destructive statement. Authorization flag first, then
 * live identity + marker, then `operation` — all on the same transaction connection.
 */
export async function runDestructiveTestOperation(
  client: PrismaClient,
  operation: (tx: RawQueryable & { $executeRawUnsafe(query: string): Promise<number> }) => Promise<void>,
  options: { env?: Record<string, string | undefined>; expected?: ExpectedTestDatabase } = {},
): Promise<void> {
  assertResetAuthorized(options.env, options.expected);
  await client.$transaction(async (tx) => {
    await verifyTestDatabaseConnection(tx, options.expected);
    await operation(tx);
  });
}
