import type { Prisma } from '@recafco/db';

export function dateRangeFilter(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) {
    return undefined;
  }
  const filter: Prisma.DateTimeFilter = {};
  if (from) {
    filter.gte = new Date(from);
  }
  if (to) {
    filter.lte = new Date(to);
  }
  return filter;
}
