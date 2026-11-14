import { Module } from '@nestjs/common';
import { SimulationModule } from '../simulation/simulation.module.js';
import { HomeAssistantController } from './homeassistant.controller.js';

@Module({
  imports: [SimulationModule],
  controllers: [HomeAssistantController],
})
export class HomeAssistantModule {}
