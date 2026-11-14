import { Injectable, computed, inject, signal } from '@angular/core';
import type { DeviceView } from '@iot-sim/shared';
import { Api, errorMessage } from './api';
import { EventStream } from './event-stream';

/**
 * Az eszközök élő listája: induláskor REST-ből töltődik, utána az SSE
 * eseményekből frissül. A felület mindig azt mutatja, amit a szerver közölt.
 */
@Injectable({ providedIn: 'root' })
export class DeviceStore {
  private readonly api = inject(Api);
  private readonly stream = inject(EventStream);

  readonly devices = signal<DeviceView[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly count = computed(() => this.devices().length);

  constructor() {
    this.stream.on('device.updated').subscribe((device) => this.upsert(device));
    this.stream.on('device.removed').subscribe(({ id }) => this.remove(id));
    this.stream.on('device.connection').subscribe(({ id, status }) => {
      this.devices.update((list) => list.map((d) => (d.id === id ? { ...d, status } : d)));
    });
    this.stream.reconnected$.subscribe(() => this.load());
    this.load();
  }

  load(): void {
    this.api.listDevices().subscribe({
      next: (devices) => {
        this.devices.set(devices);
        this.error.set(null);
        this.loaded.set(true);
      },
      error: (err) => {
        this.error.set(errorMessage(err));
        this.loaded.set(true);
      },
    });
  }

  find(id: string): DeviceView | undefined {
    return this.devices().find((d) => d.id === id);
  }

  upsert(device: DeviceView): void {
    this.devices.update((list) => {
      const index = list.findIndex((d) => d.id === device.id);
      if (index === -1) return [...list, device];
      const next = [...list];
      next[index] = device;
      return next;
    });
  }

  remove(id: string): void {
    this.devices.update((list) => list.filter((d) => d.id !== id));
  }
}
