import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Where the test database URL comes from (INCIDENT-02).
 *
 * ONLY `apps/api/.env.test` (git-ignored, written by packages/db/scripts/provision-test-database.cjs)
 * or an explicit TEST_DATABASE_URL. The repo-root `.env` and `packages/db/.env` (development
 * credentials) are never read by the test harness.
 *
 * This URL is just an address to dial. It is NOT evidence of where we are connected — the guard in
 * database-guard.ts verifies the live connection before anything else happens.
 */
const ENV_TEST_PATH = resolve(__dirname, '../../.env.test');

export function resolveTestDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }
  let content: string;
  try {
    content = readFileSync(ENV_TEST_PATH, 'utf8');
  } catch {
    throw new Error(
      `apps/api/.env.test not found. Provision the isolated test database first: ` +
        `node packages/db/scripts/provision-test-database.cjs (admin, see its header).`,
    );
  }
  const line = content.split(/\r?\n/).find((l) => /^\s*TEST_DATABASE_URL\s*=/.test(l));
  const value = line?.replace(/^\s*TEST_DATABASE_URL\s*=\s*/, '').replace(/^"(.*)"$/, '$1').trim();
  if (!value) {
    throw new Error('TEST_DATABASE_URL missing from apps/api/.env.test');
  }
  return value;
}
