import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureHttpPipeline } from '../../src/app.setup';
import { PRISMA_CLIENT } from '../../src/database/prisma-client.token';
import { runDestructiveTestOperation } from './database-guard';
import { getTestPrismaClient } from './test-prisma';

export interface ProviderOverride {
  token: unknown;
  value: unknown;
}

/**
 * Boots the real AppModule with the production HTTP pipeline. PRISMA_CLIENT is ALWAYS overridden
 * with the explicitly-configured test client, so the app can never fall back to a client derived
 * from DATABASE_URL or a global. Optional extra overrides (e.g. a fixed clock).
 */
export async function createTestApp(overrides: ProviderOverride[] = []): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PRISMA_CLIENT)
    .useValue(getTestPrismaClient());
  for (const override of overrides) {
    builder = builder.overrideProvider(override.token).useValue(override.value);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  configureHttpPipeline(app);
  await app.init();
  return app;
}

/** Signs a real access token (same strategy as production, test-only secret) for a test user. */
export function accessTokenFor(app: INestApplication, userId: string, permissions: string[]): string {
  return app.get(JwtService).sign({ sub: userId, username: `user-${userId}`, roles: [], permissions, type: 'access' });
}

/**
 * Empties every application table — ONLY through the guard: requires the explicit authorization
 * flag, then verifies the live connection identity and marker inside the same transaction that
 * runs the TRUNCATE. `_prisma_migrations` and the `test_guard` schema are never touched.
 */
export async function resetDatabase(): Promise<void> {
  await runDestructiveTestOperation(getTestPrismaClient(), async (tx) => {
    const tables = await tx.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (tables.length === 0) {
      return;
    }
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    await tx.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  });
}
