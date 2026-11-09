import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createPrismaClient } from '@recafco/db';
import { verifyTestDatabaseConnection } from './database-guard';
import { resolveTestDatabaseUrl } from './test-database';

/**
 * Once per `jest` run (INCIDENT-02 rewrite).
 *
 *  - Never imports or creates the shared application Prisma client (the INCIDENT-01 root cause).
 *    The only client here is created with an explicit URL, verified, and disconnected.
 *  - Never creates/drops databases (the test role has no CREATEDB) and never uses admin credentials.
 *  - Verifies the LIVE connection (database, role, host, port, marker) before applying the
 *    committed migrations with `prisma migrate deploy`, run as the least-privileged test role.
 *  - Restores DATABASE_URL in this outer process afterwards, because loading the generated Prisma
 *    client makes Prisma read packages/db/.env into process.env.
 */
export default async function globalSetup(): Promise<void> {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const testUrl = resolveTestDatabaseUrl();

  const client = createPrismaClient(testUrl);
  try {
    await verifyTestDatabaseConnection(client);
  } finally {
    await client.$disconnect();
  }

  execSync('pnpm exec prisma migrate deploy', {
    cwd: resolve(__dirname, '../../../../packages/db'),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });

  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
}
