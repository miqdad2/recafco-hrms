import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';

/**
 * Global HTTP pipeline shared by `main.ts` and the integration tests, so tests exercise exactly
 * the production request validation (whitelist + forbidNonWhitelisted + transform).
 */
export function configureHttpPipeline(app: INestApplication): void {
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ limit: '1mb', extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
