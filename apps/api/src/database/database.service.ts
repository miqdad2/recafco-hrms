import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@recafco/db';
import { PRISMA_CLIENT } from './prisma-client.token';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@Inject(PRISMA_CLIENT) readonly client: PrismaClient) {}

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
