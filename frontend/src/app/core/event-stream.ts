import { Injectable, OnDestroy } from '@angular/core';
import type { SimEvent, SimEventType } from '@iot-sim/shared';
import { Observable, Subject, filter, map } from 'rxjs';

const EVENT_TYPES: readonly SimEventType[] = [
  'device.updated',
  'device.removed',
  'device.connection',
  'broker.status',
  'mqtt.message',
];

type EventData<T extends SimEventType> = Extract<SimEvent, { type: T }>['data'];

/** Az /api/events SSE-folyam; megszakadás után a böngésző magától újracsatlakozik. */
@Injectable({ providedIn: 'root' })
export class EventStream implements OnDestroy {
  private readonly events = new Subject<SimEvent>();
  private readonly reconnects = new Subject<void>();
  private source: EventSource | null = null;
  private wasOpen = false;

  /** Jelez, amikor a folyam megszakadás után újra él: ilyenkor a teljes állapotot újra kell tölteni. */
  readonly reconnected$: Observable<void> = this.reconnects.asObservable();

  on<T extends SimEventType>(type: T): Observable<EventData<T>> {
    this.connect();
    return this.events.pipe(
      filter((event) => event.type === type),
      map((event) => event.data as EventData<T>),
    );
  }

  ngOnDestroy(): void {
    this.source?.close();
  }

  private connect(): void {
    if (this.source || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/events');
    this.source = source;
    source.onopen = () => {
      if (this.wasOpen) this.reconnects.next();
      this.wasOpen = true;
    };
    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (message) => {
        this.events.next({
          type,
          data: JSON.parse((message as MessageEvent<string>).data),
        } as SimEvent);
      });
    }
  }
}
