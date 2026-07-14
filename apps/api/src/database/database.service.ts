import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { prisma, type PrismaClient } from '@recafco/db';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  readonly client: PrismaClient = prisma;

  async onModuleInit(): Promise<void> {
    try {
      await this.client.$connect();
    } catch (error) {
      this.logger.warn(
        'Database connection failed during startup. The API will still start; ' +
          'connectivity will be retried lazily on the next query.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
