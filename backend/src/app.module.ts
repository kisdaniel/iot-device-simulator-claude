import { Module } from '@nestjs/common';
import { BrokerModule } from './broker/broker.module.js';
import { AppConfigModule } from './config/config.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { HealthController } from './health/health.controller.js';
import { StorageModule } from './storage/storage.module.js';

@Module({
  imports: [AppConfigModule, StorageModule, BrokerModule, DevicesModule],
  controllers: [HealthController],
})
export class AppModule {}
