import { Global, Module } from '@nestjs/common';
import { getSharedPrismaClient } from '@recafco/db';
import { DatabaseService } from './database.service';
import { PRISMA_CLIENT } from './prisma-client.token';

@Global()
@Module({
  providers: [
    // Factory runs only if nothing overrides the token (tests always override it). Under Jest the
    // shared client refuses to construct, so a missing override fails closed.
    { provide: PRISMA_CLIENT, useFactory: () => getSharedPrismaClient() },
    DatabaseService,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
