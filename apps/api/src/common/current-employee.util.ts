import { BadRequestException } from '@nestjs/common';
import type { PrismaClient } from '@recafco/db';

export async function resolveEmployeeIdForUser(prisma: PrismaClient, userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.employeeId) {
    throw new BadRequestException('Current user is not linked to an employee record');
  }
  return user.employeeId;
}
