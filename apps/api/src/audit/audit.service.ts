import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@recafco/db';
import { DatabaseService } from '../database/database.service';

export interface AuditEntry {
  actorUserId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      const data: Prisma.AuditLogUncheckedCreateInput = {
        actorUserId: entry.actorUserId ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      };
      if (entry.beforeSnapshot !== undefined) {
        data.beforeSnapshot = entry.beforeSnapshot as Prisma.InputJsonValue;
      }
      if (entry.afterSnapshot !== undefined) {
        data.afterSnapshot = entry.afterSnapshot as Prisma.InputJsonValue;
      }

      await this.databaseService.client.auditLog.create({ data });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log entry (${entry.entityType}/${entry.action})`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
