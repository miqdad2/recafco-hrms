import { PrismaClient } from '@prisma/client';

/**
 * INCIDENT-02 — Prisma client construction rules.
 *
 * Previously this module ran `globalThis.__recafcoPrisma ?? new PrismaClient()` AT IMPORT TIME and
 * cached the instance on `globalThis`. Under Jest that made a client bound to the development
 * database (via packages/db/.env) leak from the global-setup process into every test sandbox
 * (jest-environment-node copies outer globals), and the tests truncated `recafco_hrms_dev`
 * (INCIDENT-01). Now:
 *
 *  1. Importing this package constructs NOTHING and touches no global.
 *  2. `createPrismaClient(url)` builds a client bound to an EXPLICIT URL (Prisma `datasourceUrl`,
 *     which takes precedence over `env("DATABASE_URL")` and any .env file). Tests must use this.
 *  3. `getSharedPrismaClient()` is the application's lazily-created singleton, held in module
 *     scope only (never on `globalThis`). It refuses to run under Jest, so a test that forgets to
 *     inject its own client fails closed instead of silently using DATABASE_URL.
 */

export function createPrismaClient(datasourceUrl: string): PrismaClient {
  if (!datasourceUrl) {
    throw new Error('createPrismaClient requires an explicit datasource URL');
  }
  return new PrismaClient({ datasourceUrl });
}

let sharedClient: PrismaClient | undefined;

export function getSharedPrismaClient(): PrismaClient {
  if (process.env.JEST_WORKER_ID !== undefined) {
    throw new Error(
      'The shared application Prisma client is disabled under Jest. Inject a client created with ' +
        'createPrismaClient(<verified test database URL>) instead (see apps/api/test/support).',
    );
  }
  sharedClient ??= new PrismaClient();
  return sharedClient;
}
