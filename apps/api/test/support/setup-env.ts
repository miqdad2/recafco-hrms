import { resolveTestDatabaseUrl } from './test-database';

// Runs before every test file. INCIDENT-02: no development credential is read here.
//
// DATABASE_URL is set ONLY because the API's env schema (src/config/env.schema.ts) requires the
// variable to exist. No Prisma client is created from it: the app's client is injected via the
// PRISMA_CLIENT token (test/support/app.ts), and the shared client refuses to run under Jest.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = resolveTestDatabaseUrl();
// Test-only signing secrets: not the development/production JWT secrets.
process.env.JWT_ACCESS_SECRET = 'recafco-test-only-access-secret-not-for-real-use';
process.env.JWT_REFRESH_SECRET = 'recafco-test-only-refresh-secret-not-for-real-use';
