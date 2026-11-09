/**
 * DI token for the PrismaClient used by DatabaseService (INCIDENT-02). Production resolves it to
 * the lazily-created shared client; integration tests override it with a client bound to the
 * verified test database. Nothing in the API may construct or import a client any other way.
 */
export const PRISMA_CLIENT = Symbol('PRISMA_CLIENT');
