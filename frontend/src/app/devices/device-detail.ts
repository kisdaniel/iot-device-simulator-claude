import { DatePipe } from '@angular/common';
import { DestroyRef, Component, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import type { DeviceView, MqttLogEntry } from '@iot-sim/shared';
import { Api, errorMessage } from '../core/api';
import { DeviceStore } from '../core/device-store';
import { EventStream } from '../core/event-stream';
import { identity, shellyTopics, switchLabel, typeLabel } from './device-labels';
import { MeterEditor } from './meter-editor';

const LOG_LIMIT = 200;

@Component({
  selector: 'app-device-detail',
  imports: [RouterLink, DatePipe, MeterEditor],
  templateUrl: './device-detail.html',
})
export class DeviceDetail {
  private readonly api = inject(Api);
  private readonly store = inject(DeviceStore);
  private readonly stream = inject(EventStream);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly id = input.required<string>();

  protected readonly device = computed(() => this.store.find(this.id()));
  protected readonly notFound = computed(() => this.store.loaded() && !this.device());
  protected readonly topics = computed(() => {
    const device = this.device();
    return device ? shellyTopics(device) : [];
  });
  /** Az üzenetnapló, legújabb elöl. */
  protected readonly messages = signal<MqttLogEntry[]>([]);
  protected readonly busy = signal(false);
  /** A számlálók élő léptetéséhez; másodpercenként frissül. */
  protected readonly now = signal(Date.now());
  protected readonly error = signal<string | null>(null);

  protected readonly typeLabel = typeLabel;
  protected readonly identity = identity;
  protected readonly switchLabel = switchLabel;

  constructor() {
    effect(() => this.loadMessages(this.id()));
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => clearInterval(timer));
    this.stream
      .on('mqtt.message')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((entry) => {
        if (entry.deviceId !== this.id()) return;
        this.messages.update((list) => [entry, ...list].slice(0, LOG_LIMIT));
      });
  }

  protected toggle(event: Event, device: DeviceView, index: number, output: boolean): void {
    event.preventDefault();
    this.run(this.api.setSwitch(device.id, index, !output));
  }

  protected setEnabled(device: DeviceView, enabled: boolean): void {
    this.run(this.api.setEnabled(device.id, enabled));
  }

  protected remove(device: DeviceView): void {
    if (!confirm(`Biztosan törlöd: ${device.name}?`)) return;
    this.busy.set(true);
    this.api.deleteDevice(device.id).subscribe({
      next: () => {
        this.store.remove(device.id);
        void this.router.navigate(['/']);
      },
      error: (err) => this.fail(err),
    });
  }

  protected clearLog(): void {
    this.messages.set([]);
  }

  private loadMessages(id: string): void {
    this.api.messages(id).subscribe({
      next: (list) => this.messages.set([...list].reverse()),
      error: () => this.messages.set([]),
    });
  }

  private run(request: ReturnType<Api['setSwitch']>): void {
    this.busy.set(true);
    this.error.set(null);
    request.subscribe({
      next: (view) => {
        this.store.upsert(view);
        this.busy.set(false);
      },
      error: (err) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.error.set(errorMessage(err));
    this.busy.set(false);
  }
}
