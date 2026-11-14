import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { DeviceEntity } from './entities/device.entity.js';
import { SettingEntity } from './entities/setting.entity.js';
import { SwitchEntity } from './entities/switch.entity.js';
import { TemperatureSensorEntity } from './entities/temperature-sensor.entity.js';
import { InitialSchema1794650000000 } from './migrations/1794650000000-initial-schema.js';
import { SettingsStore } from './settings.store.js';

export const ENTITIES = [
  SettingEntity,
  DeviceEntity,
  SwitchEntity,
  TemperatureSensorEntity,
];
export const MIGRATIONS = [InitialSchema1794650000000];

export const DATABASE_FILE = 'simulator.sqlite';

/** Az adatbázis helye; a ":memory:" adatkönyvtár memóriabeli adatbázist ad (tesztekhez). */
export function databasePath(dataDir: string): string {
  if (dataDir === ':memory:') return ':memory:';
  mkdirSync(dataDir, { recursive: true });
  return join(dataDir, DATABASE_FILE);
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): TypeOrmModuleOptions => ({
        type: 'better-sqlite3',
        database: databasePath(config.dataDir),
        entities: ENTITIES,
        migrations: MIGRATIONS,
        migrationsRun: true,
        synchronize: false,
        enableWAL: config.dataDir !== ':memory:',
      }),
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  providers: [SettingsStore],
  exports: [TypeOrmModule, SettingsStore],
})
export class StorageModule {}
