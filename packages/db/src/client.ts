import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __recafcoPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient = globalThis.__recafcoPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__recafcoPrisma = prisma;
}
