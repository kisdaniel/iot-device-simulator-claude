import { Module } from '@nestjs/common';
import { BrokerModule } from '../broker/broker.module.js';
import { DevicesModule } from '../devices/devices.module.js';
import { ProfileRegistry } from './profile-registry.js';
import { SimulationController } from './simulation.controller.js';
import { SimulationService } from './simulation.service.js';

@Module({
  imports: [BrokerModule, DevicesModule],
  controllers: [SimulationController],
  providers: [ProfileRegistry, SimulationService],
  exports: [ProfileRegistry, SimulationService],
})
export class SimulationModule {}
