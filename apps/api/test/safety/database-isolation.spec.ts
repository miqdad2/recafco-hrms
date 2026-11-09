/**
 * INCIDENT-02 safety regression suite. NON-DESTRUCTIVE BY DESIGN: nothing here truncates,
 * deletes, or writes application data. Real-database checks only SELECT or attempt to connect.
 *
 * Run alone with:  pnpm --filter @recafco/api test:safety
 */
import type { INestApplication } from '@nestjs/common';
import { createPrismaClient, getSharedPrismaClient, type PrismaClient } from '@recafco/db';
import { DatabaseService } from '../../src/database/database.service';
import { createTestApp } from '../support/app';
import {
  assertResetAuthorized,
  EXPECTED_TEST_DATABASE,
  RESET_AUTHORIZATION_ENV,
  runDestructiveTestOperation,
  TEST_MARKER_PURPOSE,
  TestDatabaseGuardError,
  verifyTestDatabaseConnection,
  type RawQueryable,
} from '../support/database-guard';
import { resolveTestDatabaseUrl } from '../support/test-database';
import { getTestPrismaClient } from '../support/test-prisma';

interface FakeConnection {
  database?: string;
  role?: string;
  sessionRole?: string;
  address?: string | null;
  port?: number;
  marker?: { purpose: string; database_name: string } | 'missing-table' | 'no-row';
}

/** A fake connection that reports whatever identity we tell it to — no database involved. */
function fakeConnection(overrides: FakeConnection = {}): RawQueryable & { destructiveCalls: number } {
  const state = {
    database: EXPECTED_TEST_DATABASE.database,
    role: EXPECTED_TEST_DATABASE.role,
    address: '127.0.0.1',
    port: EXPECTED_TEST_DATABASE.port,
    marker: { purpose: TEST_MARKER_PURPOSE, database_name: EXPECTED_TEST_DATABASE.database },
    ...overrides,
  };
  const fake = {
    destructiveCalls: 0,
    async $queryRawUnsafe<T>(query: string): Promise<T> {
      if (query.includes('current_database()')) {
        return [
          {
            database: state.database,
            current_role: state.role,
            session_role: state.sessionRole ?? state.role,
            server_address: state.address,
            server_port: state.port,
          },
        ] as T;
      }
      if (query.includes('test_guard.marker')) {
        if (state.marker === 'missing-table') throw new Error('relation "test_guard.marker" does not exist');
        return (state.marker === 'no-row' ? [] : [state.marker]) as T;
      }
      fake.destructiveCalls += 1;
      throw new Error(`unexpected query in fake: ${query}`);
    },
  };
  return fake;
}

const AUTHORIZED_ENV = { [RESET_AUTHORIZATION_ENV]: `ALLOW_TRUNCATE_${EXPECTED_TEST_DATABASE.database}` };

function urlForDatabase(database: string): string {
  const url = new URL(resolveTestDatabaseUrl());
  url.pathname = `/${database}`;
  return url.toString();
}

async function connectionError(database: string): Promise<string> {
  const client: PrismaClient = createPrismaClient(urlForDatabase(database));
  try {
    await client.$queryRawUnsafe('SELECT 1');
    return 'CONNECTED';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

describe('INCIDENT-02 guard — refuses wrong connections (fake connections, no database)', () => {
  it('accepts the expected test identity (control case)', async () => {
    await expect(verifyTestDatabaseConnection(fakeConnection())).resolves.toMatchObject({
      database: 'recafco_hrms_test',
      role: 'recafco_test',
    });
  });

  it('1. rejects a connection reporting recafco_hrms_dev', async () => {
    await expect(verifyTestDatabaseConnection(fakeConnection({ database: 'recafco_hrms_dev' }))).rejects.toThrow(
      /connected to database "recafco_hrms_dev"/,
    );
  });

  it('1b. rejects any database not ending in _test even if configured as expected', async () => {
    const expected = { ...EXPECTED_TEST_DATABASE, database: 'recafco_hrms_dev' };
    await expect(
      verifyTestDatabaseConnection(fakeConnection({ database: 'recafco_hrms_dev' }), expected),
    ).rejects.toThrow(TestDatabaseGuardError);
  });

  it('2. rejects an unexpected role (current or session)', async () => {
    await expect(verifyTestDatabaseConnection(fakeConnection({ role: 'postgres' }))).rejects.toThrow(/expected role/);
    await expect(verifyTestDatabaseConnection(fakeConnection({ sessionRole: 'postgres' }))).rejects.toThrow(/expected role/);
  });

  it('3. rejects an unexpected server address or port', async () => {
    await expect(verifyTestDatabaseConnection(fakeConnection({ address: '10.0.0.5' }))).rejects.toThrow(/server address/);
    await expect(verifyTestDatabaseConnection(fakeConnection({ address: null }))).rejects.toThrow(/server address/);
    await expect(verifyTestDatabaseConnection(fakeConnection({ port: 5433 }))).rejects.toThrow(/server port/);
  });

  it('4. rejects a missing marker table, missing marker row, wrong purpose, or foreign marker', async () => {
    await expect(verifyTestDatabaseConnection(fakeConnection({ marker: 'missing-table' }))).rejects.toThrow(/marker table/);
    await expect(verifyTestDatabaseConnection(fakeConnection({ marker: 'no-row' }))).rejects.toThrow(/marker row/);
    await expect(
      verifyTestDatabaseConnection(fakeConnection({ marker: { purpose: 'SOMETHING_ELSE', database_name: 'recafco_hrms_test' } })),
    ).rejects.toThrow(/marker row/);
    await expect(
      verifyTestDatabaseConnection(
        fakeConnection({ marker: { purpose: TEST_MARKER_PURPOSE, database_name: 'recafco_hrms_other_test' } }),
      ),
    ).rejects.toThrow(/marker belongs to/);
  });

  it('5. rejects destructive cleanup without the explicit authorization flag', () => {
    expect(() => assertResetAuthorized({})).toThrow(new RegExp(RESET_AUTHORIZATION_ENV));
    expect(() => assertResetAuthorized({ [RESET_AUTHORIZATION_ENV]: 'yes' })).toThrow(TestDatabaseGuardError);
    expect(() => assertResetAuthorized(AUTHORIZED_ENV)).not.toThrow();
  });

  it('5b. without the flag, the destructive operation callback is never invoked', async () => {
    const operation = jest.fn(async () => undefined);
    await expect(runDestructiveTestOperation(getTestPrismaClient(), operation, { env: {} })).rejects.toThrow(
      TestDatabaseGuardError,
    );
    expect(operation).not.toHaveBeenCalled();
  });
});

describe('INCIDENT-02 guard — real connections (read-only)', () => {
  it('verifies the live test connection: database, role, local host/port, marker', async () => {
    const verified = await verifyTestDatabaseConnection(getTestPrismaClient());
    expect(verified.database).toBe('recafco_hrms_test');
    expect(verified.role).toBe('recafco_test');
    expect(['127.0.0.1', '::1']).toContain(verified.serverAddress);
    expect(verified.serverPort).toBe(5432);
  });

  it('with the flag set, verification passes on the same transaction connection (no-op operation)', async () => {
    const operation = jest.fn(async () => undefined);
    await runDestructiveTestOperation(getTestPrismaClient(), operation, { env: AUTHORIZED_ENV });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('the test role holds no elevated attributes or role memberships', async () => {
    const [role] = await getTestPrismaClient().$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls,
              (SELECT count(*)::int FROM pg_auth_members WHERE member = r.oid) AS memberships
       FROM pg_roles r WHERE rolname = current_user`,
    );
    expect(role).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolreplication: false,
      rolbypassrls: false,
      memberships: 0,
    });
  });

  it('6. the test role cannot connect to the development database', async () => {
    const message = await connectionError('recafco_hrms_dev');
    expect(message).not.toBe('CONNECTED');
    expect(message).toMatch(/pg_hba\.conf rejects connection|permission denied|not allowed|denied access/i);
  });

  it.each(['postgres', 'template1', 'recafco_hrms_test_incident01_archive'])(
    '7. the test role cannot connect to unrelated database %s',
    async (database) => {
      const message = await connectionError(database);
      expect(message).not.toBe('CONNECTED');
      expect(message).toMatch(/pg_hba\.conf rejects connection|permission denied|not allowed|denied access/i);
    },
  );
});

describe('INCIDENT-02 — no reuse of a shared development Prisma client', () => {
  let app: INestApplication | undefined;
  const g = globalThis as Record<string, unknown>;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    delete g.__recafcoPrisma;
  });

  it('8a. importing @recafco/db creates no global client', () => {
    expect(g.__recafcoPrisma).toBeUndefined();
  });

  it('8b. the shared application client refuses to construct under Jest', () => {
    expect(() => getSharedPrismaClient()).toThrow(/disabled under Jest/);
  });

  it('8c. the app uses the injected test client even if a "dev" client is planted globally and DATABASE_URL points at dev', async () => {
    const plantedSentinel = { planted: true };
    g.__recafcoPrisma = plantedSentinel;
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://someone:pw@127.0.0.1:5432/recafco_hrms_dev';
    try {
      app = await createTestApp();
    } finally {
      process.env.DATABASE_URL = previous;
    }

    const service = app.get(DatabaseService);
    expect(service.client).toBe(getTestPrismaClient());
    expect(service.client).not.toBe(plantedSentinel);
    const [row] = await service.client.$queryRawUnsafe<{ db: string; who: string }[]>(
      'SELECT current_database() AS db, current_user AS who',
    );
    expect(row).toEqual({ db: 'recafco_hrms_test', who: 'recafco_test' });
  });
});
