import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { APP_VERSION } from './version.js';

export const API_PREFIX = 'api';

/** A main.ts és a tesztek közös beállítása: előtag, validáció, Swagger. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('IoT eszközszimulátor')
      .setDescription(
        'Shelly és Tasmota eszközök szimulációja MQTT-n keresztül',
      )
      .setVersion(APP_VERSION)
      .build(),
  );
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);
}

/**
 * Éles futáskor a backend szolgálja ki az Angular buildet is: a statikus fájlokat,
 * és minden nem /api útvonalra az index.html-t (kliensoldali útválasztás).
 */
export function serveFrontend(
  app: NestExpressApplication,
  publicDir: string,
): boolean {
  const indexFile = join(publicDir, 'index.html');
  if (!existsSync(indexFile)) return false;

  app.useStaticAssets(publicDir);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const isApi =
      req.path === `/${API_PREFIX}` || req.path.startsWith(`/${API_PREFIX}/`);
    if (req.method !== 'GET' || isApi) {
      next();
      return;
    }
    res.sendFile(indexFile);
  });
  return true;
}
