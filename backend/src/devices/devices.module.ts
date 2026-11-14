import { Module } from '@nestjs/common';
import { SimulationModule } from '../simulation/simulation.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';

@Module({
  imports: [StorageModule, SimulationModule],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
