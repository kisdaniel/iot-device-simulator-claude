import { Controller, type MessageEvent, Sse } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { interval, map, merge, type Observable } from 'rxjs';
import { EventBus } from './event-bus.service.js';

const HEARTBEAT_MS = 25_000;

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly bus: EventBus) {}

  @Sse()
  @ApiOperation({
    summary: 'SSE eseményfolyam: eszköz- és brokerállapot, MQTT-üzenetek',
  })
  events(): Observable<MessageEvent> {
    const events = this.bus
      .stream()
      .pipe(
        map((event): MessageEvent => ({ type: event.type, data: event.data })),
      );
    // A szívverés életben tartja a kapcsolatot a közbenső proxykon.
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: {} })),
    );
    return merge(events, heartbeat);
  }
}
