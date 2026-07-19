import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { validatePasswordPolicy } from '../auth/password-policy.util';
import { hashPassword } from '../auth/password.util';
import { toJsonSnapshot } from '../common/audit-snapshot.util';
import type { RequestContext } from '../common/request-context.util';
import { DatabaseService } from '../database/database.service';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  private get prisma() {
    return this.databaseService.client;
  }

  async resetPassword(
    userId: string,
    dto: ResetPasswordDto,
    actorUserId: string,
    context: RequestContext,
  ): Promise<{
    user: { id: string; username: string; employeeId: string | null; status: string; mustChangePassword: boolean };
    temporaryPassword: string;
  }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { employee: true } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    let temporaryPassword = dto.temporaryPassword;
    if (!temporaryPassword) {
      if (!user.employee) {
        throw new BadRequestException(
          'This user has no linked employee — provide temporaryPassword explicitly',
        );
      }
      temporaryPassword = `Recafco@${user.employee.employeeCode}`;
    }

    const policyError = validatePasswordPolicy(temporaryPassword, user.username);
    if (policyError) {
      throw new BadRequestException(policyError);
    }

    const passwordHash = await hashPassword(temporaryPassword);
    const now = new Date();

    const beforeSnapshot = {
      id: user.id,
      username: user.username,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
    };

    const [updated] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          mustChangePassword: true,
          temporaryPasswordIssuedAt: now,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    await this.auditService.record({
      actorUserId,
      entityType: 'User',
      entityId: userId,
      action: 'USER_PASSWORD_RESET',
      beforeSnapshot: toJsonSnapshot(beforeSnapshot),
      afterSnapshot: toJsonSnapshot({
        id: updated.id,
        username: updated.username,
        status: updated.status,
        mustChangePassword: updated.mustChangePassword,
        temporaryPasswordIssuedAt: updated.temporaryPasswordIssuedAt,
      }),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return {
      user: {
        id: updated.id,
        username: updated.username,
        employeeId: updated.employeeId,
        status: updated.status,
        mustChangePassword: updated.mustChangePassword,
      },
      temporaryPassword,
    };
  }
}
