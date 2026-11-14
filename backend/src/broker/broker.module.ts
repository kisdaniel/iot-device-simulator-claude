import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { BrokerController } from './broker.controller.js';
import { BrokerService } from './broker.service.js';

@Module({
  imports: [StorageModule],
  controllers: [BrokerController],
  providers: [BrokerService],
  exports: [BrokerService],
})
export class BrokerModule {}
