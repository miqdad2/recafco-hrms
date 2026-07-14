import type { Prisma } from '@recafco/db';

/** Normalizes a Prisma model (which may contain Date objects) into a JSON-safe snapshot for audit logging. */
export function toJsonSnapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
