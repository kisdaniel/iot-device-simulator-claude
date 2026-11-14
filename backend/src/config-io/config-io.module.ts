import { Module } from '@nestjs/common';
import { BrokerModule } from '../broker/broker.module.js';
import { EventsModule } from '../events/events.module.js';
import { SimulationModule } from '../simulation/simulation.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { ConfigIoController } from './config-io.controller.js';
import { ConfigIoService } from './config-io.service.js';

/** JSON konfiguráció: export, import és az indításkori betöltés (CONFIG_FILE). */
@Module({
  imports: [SimulationModule, StorageModule, BrokerModule, EventsModule],
  controllers: [ConfigIoController],
  providers: [ConfigIoService],
})
export class ConfigIoModule {}
