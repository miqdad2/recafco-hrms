import { createPrismaClient, type PrismaClient } from '@recafco/db';
import { resolveTestDatabaseUrl } from './test-database';

/**
 * The one Prisma client the tests use, created with an EXPLICIT datasource URL (Prisma
 * `datasourceUrl`, which overrides env("DATABASE_URL") and every .env file). It is injected into
 * the Nest app (PRISMA_CLIENT) and used by fixtures and by the guarded cleanup, so all three share
 * one verified connection pool. It lives in this module's scope only — never on `globalThis`.
 */
let client: PrismaClient | undefined;

export function getTestPrismaClient(): PrismaClient {
  client ??= createPrismaClient(resolveTestDatabaseUrl());
  return client;
}
