import { Module } from '@nestjs/common';
import { MqttGateway } from '../mqtt/mqtt-gateway.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { BrokerController } from './broker.controller.js';
import { BrokerService } from './broker.service.js';

/** A brokerbeállítás és a rá épülő közös MQTT-kapcsolat. */
@Module({
  imports: [StorageModule],
  controllers: [BrokerController],
  providers: [BrokerService, MqttGateway],
  exports: [BrokerService, MqttGateway],
})
export class BrokerModule {}
