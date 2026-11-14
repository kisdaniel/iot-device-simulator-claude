import { Global, Module } from '@nestjs/common';
import { EventBus } from './event-bus.service.js';
import { EventsController } from './events.controller.js';

@Global()
@Module({
  controllers: [EventsController],
  providers: [EventBus],
  exports: [EventBus],
})
export class EventsModule {}
