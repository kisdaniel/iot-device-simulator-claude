import { Injectable, computed, inject, signal } from '@angular/core';
import type { BrokerConnection } from '@iot-sim/shared';
import { Api } from './api';
import { EventStream } from './event-stream';

const LABELS: Record<BrokerConnection['status'], string> = {
  connected: 'Broker: csatlakozva',
  connecting: 'Broker: kapcsolódás…',
  disconnected: 'Broker: nincs kapcsolat',
  error: 'Broker: hiba',
};

const BADGES: Record<BrokerConnection['status'], string> = {
  connected: 'text-bg-success',
  connecting: 'text-bg-secondary',
  disconnected: 'text-bg-warning',
  error: 'text-bg-danger',
};

/** A közös MQTT-kapcsolat állapota: induláskor REST-ből, utána az eseményfolyamból. */
@Injectable({ providedIn: 'root' })
export class BrokerStatus {
  private readonly api = inject(Api);
  private readonly stream = inject(EventStream);

  readonly connection = signal<BrokerConnection | null>(null);
  readonly label = computed(() => {
    const connection = this.connection();
    return connection ? LABELS[connection.status] : 'Broker: ismeretlen';
  });
  readonly badgeClass = computed(() => {
    const connection = this.connection();
    return connection ? BADGES[connection.status] : 'text-bg-secondary';
  });

  constructor() {
    this.stream.on('broker.status').subscribe((connection) => this.connection.set(connection));
    this.stream.reconnected$.subscribe(() => this.refresh());
    this.refresh();
  }

  refresh(): void {
    this.api.getBroker().subscribe({
      next: (view) => this.connection.set(view.connection),
      error: () => this.connection.set(null),
    });
  }
}
