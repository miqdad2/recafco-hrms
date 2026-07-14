import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly databaseService: DatabaseService) {}

  @Get()
  getHealth(): { status: string; service: string; timestamp: string } {
    return {
      status: 'ok',
      service: 'recafco-hrms-api',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('db')
  async getDatabaseHealth(): Promise<{ status: string; database: string; timestamp: string }> {
    try {
      await this.databaseService.client.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Database health check failed', error instanceof Error ? error.stack : undefined);
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'unreachable',
        timestamp: new Date().toISOString(),
      });
    }
  }
}
