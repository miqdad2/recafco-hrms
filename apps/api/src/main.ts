import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureHttpPipeline } from './app.setup';
import type { EnvConfig } from './config/env.schema';

const ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
  : ['http://localhost:3000', 'http://localhost:19006'];

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  configureHttpPipeline(app);

  app.enableCors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
  });

  app.enableShutdownHooks();

  const configService = app.get(ConfigService<EnvConfig, true>);
  const port = configService.get('API_PORT', { infer: true });

  await app.listen(port);
}

void bootstrap();
