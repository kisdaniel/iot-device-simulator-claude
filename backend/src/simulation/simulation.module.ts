import { Module } from '@nestjs/common';
import { BrokerModule } from '../broker/broker.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { ProfileRegistry } from './profile-registry.js';
import { ShellyProfile } from './profiles/shelly/shelly.profile.js';
import { TasmotaProfile } from './profiles/tasmota/tasmota.profile.js';
import { SimulationService } from './simulation.service.js';

/** A beépített eszközprofilok. */
function createRegistry(): ProfileRegistry {
  const registry = new ProfileRegistry();
  registry.register(new ShellyProfile('shelly-1pm'));
  registry.register(new ShellyProfile('shelly-2pm'));
  registry.register(new TasmotaProfile());
  return registry;
}

@Module({
  imports: [BrokerModule, StorageModule],
  providers: [
    { provide: ProfileRegistry, useFactory: createRegistry },
    SimulationService,
  ],
  exports: [ProfileRegistry, SimulationService],
})
export class SimulationModule {}
