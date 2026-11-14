import { resolve } from 'node:path';
import { Logger, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp, serveFrontend } from './app.setup.js';
import { EnvValidationError, loadConfig } from './config/env.js';

const NEST_LOG_LEVELS: Record<string, LogLevel[]> = {
  error: ['error'],
  warn: ['error', 'warn'],
  info: ['error', 'warn', 'log'],
  debug: ['error', 'warn', 'log', 'debug'],
};

async function bootstrap() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: NEST_LOG_LEVELS[config.logLevel],
  });
  configureApp(app);

  const logger = new Logger('Bootstrap');
  const publicDir = resolve(process.env.PUBLIC_DIR ?? 'public');
  if (serveFrontend(app, publicDir)) {
    logger.log(`Frontend kiszolgálása innen: ${publicDir}`);
  }

  await app.listen(config.port);
  logger.log(
    `A szimulátor fut: http://localhost:${config.port} (API: /api, leírás: /api/docs)`,
  );
}
await bootstrap();
