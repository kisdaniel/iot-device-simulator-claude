import { Module } from '@nestjs/common';
import { BrokerModule } from './broker/broker.module.js';
import { AppConfigModule } from './config/config.module.js';
import { DevicesModule } from './devices/devices.module.js';
import { EventsModule } from './events/events.module.js';
import { HealthController } from './health/health.controller.js';
import { SimulationModule } from './simulation/simulation.module.js';
import { StorageModule } from './storage/storage.module.js';

@Module({
  imports: [
    AppConfigModule,
    StorageModule,
    EventsModule,
    BrokerModule,
    DevicesModule,
    SimulationModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
