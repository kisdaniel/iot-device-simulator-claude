import type { SimEvent } from '@iot-sim/shared';
import { Injectable } from '@nestjs/common';
import { type Observable, Subject } from 'rxjs';

/** Belső eseménybusz: a szimuláció ide teszi az eseményeket, az SSE végpont innen olvas. */
@Injectable()
export class EventBus {
  private readonly subject = new Subject<SimEvent>();

  emit(event: SimEvent): void {
    this.subject.next(event);
  }

  stream(): Observable<SimEvent> {
    return this.subject.asObservable();
  }
}
