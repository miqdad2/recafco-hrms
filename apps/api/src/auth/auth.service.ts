import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import type { EnvConfig } from '../config/env.schema';
import { DatabaseService } from '../database/database.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { verifyPassword } from './password.util';
import { hashToken } from './token-hash.util';
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
  RequestContext,
  TokenPair,
} from './types/auth.types';

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvConfig, true>,
    private readonly auditService: AuditService,
  ) {}

  private get prisma() {
    return this.databaseService.client;
  }

  async login(dto: LoginDto, context: RequestContext): Promise<TokenPair> {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.identifier }, { email: dto.identifier }] },
    });

    if (!user) {
      await this.auditService.record({
        entityType: 'User',
        entityId: dto.identifier,
        action: 'LOGIN_FAILED',
        afterSnapshot: { reason: 'not_found' },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      await this.auditService.record({
        actorUserId: user.id,
        entityType: 'User',
        entityId: user.id,
        action: 'LOGIN_FAILED',
        afterSnapshot: { reason: 'disabled' },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.auditService.record({
        actorUserId: user.id,
        entityType: 'User',
        entityId: user.id,
        action: 'LOGIN_FAILED',
        afterSnapshot: { reason: 'locked', lockedUntil: user.lockedUntil.toISOString() },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await verifyPassword(user.passwordHash, dto.password);

    if (!passwordValid) {
      const failedAttempts = user.failedLoginAttempts + 1;
      const shouldLock = failedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: shouldLock ? 0 : failedAttempts,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
        },
      });

      await this.auditService.record({
        actorUserId: user.id,
        entityType: 'User',
        entityId: user.id,
        action: shouldLock ? 'USER_LOCKED' : 'LOGIN_FAILED',
        afterSnapshot: { reason: 'invalid_password', failedAttempts },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const { roles, permissions } = await this.resolveRolesAndPermissions(user.id);
    const tokens = await this.issueTokenPair(user.id, user.username, roles, permissions, context);

    await this.auditService.record({
      actorUserId: user.id,
      entityType: 'User',
      entityId: user.id,
      action: 'LOGIN_SUCCESS',
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return tokens;
  }

  async refresh(dto: RefreshTokenDto, context: RequestContext): Promise<TokenPair> {
    const refreshSecret = this.configService.get('JWT_REFRESH_SECRET', { infer: true });

    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(dto.refreshToken, {
        secret: refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const stored = await this.prisma.refreshToken.findUnique({ where: { id: payload.jti } });
    const tokenHash = hashToken(dto.refreshToken);

    if (
      !stored ||
      stored.tokenHash !== tokenHash ||
      stored.revokedAt !== null ||
      stored.expiresAt.getTime() < Date.now() ||
      stored.userId !== payload.sub
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const { roles, permissions } = await this.resolveRolesAndPermissions(user.id);
    const tokens = await this.issueTokenPair(user.id, user.username, roles, permissions, context);

    await this.auditService.record({
      actorUserId: user.id,
      entityType: 'RefreshToken',
      entityId: stored.id,
      action: 'REFRESH_TOKEN_USED',
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return tokens;
  }

  async logout(dto: RefreshTokenDto, context: RequestContext): Promise<void> {
    const tokenHash = hashToken(dto.refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({ where: { tokenHash } });

    if (stored && stored.revokedAt === null) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });

      await this.auditService.record({
        actorUserId: stored.userId,
        entityType: 'RefreshToken',
        entityId: stored.id,
        action: 'LOGOUT',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    }
  }

  async getProfile(userId: string): Promise<{
    id: string;
    username: string;
    email: string | null;
    employeeId: string | null;
    status: string;
    mustChangePassword: boolean;
    lastLoginAt: Date | null;
    roles: string[];
    permissions: string[];
  }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }

    const { roles, permissions } = await this.resolveRolesAndPermissions(userId);

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      employeeId: user.employeeId,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt,
      roles,
      permissions,
    };
  }

  private async resolveRolesAndPermissions(
    userId: string,
  ): Promise<{ roles: string[]; permissions: string[] }> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });

    const roles = userRoles.map((userRole) => userRole.role.code);
    const permissionSet = new Set<string>();
    for (const userRole of userRoles) {
      for (const rolePermission of userRole.role.rolePermissions) {
        permissionSet.add(rolePermission.permission.code);
      }
    }

    return { roles, permissions: Array.from(permissionSet) };
  }

  private async issueTokenPair(
    userId: string,
    username: string,
    roles: string[],
    permissions: string[],
    context: RequestContext,
  ): Promise<TokenPair> {
    const accessSecret = this.configService.get('JWT_ACCESS_SECRET', { infer: true });
    const accessExpiresIn = this.configService.get('JWT_ACCESS_EXPIRES_IN', { infer: true });
    const refreshSecret = this.configService.get('JWT_REFRESH_SECRET', { infer: true });
    const refreshExpiresIn = this.configService.get('JWT_REFRESH_EXPIRES_IN', { infer: true });

    const accessPayload: AccessTokenPayload = {
      sub: userId,
      username,
      roles,
      permissions,
      type: 'access',
    };
    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: accessSecret,
      expiresIn: accessExpiresIn as NonNullable<JwtSignOptions['expiresIn']>,
    });

    const refreshId = randomUUID();
    const refreshPayload: RefreshTokenPayload = { sub: userId, jti: refreshId, type: 'refresh' };
    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: refreshSecret,
      expiresIn: refreshExpiresIn as NonNullable<JwtSignOptions['expiresIn']>,
    });

    const decoded = this.jwtService.decode<{ exp?: number }>(refreshToken);
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        id: refreshId,
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });

    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: accessExpiresIn };
  }
}
