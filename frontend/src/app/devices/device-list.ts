import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { DeviceType, DeviceView } from '@iot-sim/shared';
import { Api, errorMessage } from '../core/api';
import { DeviceStore } from '../core/device-store';
import { identity, switchLabel, typeLabel } from './device-labels';
import { formatNumber, meterActive, meterValues } from './meter-values';

@Component({
  selector: 'app-device-list',
  imports: [RouterLink],
  templateUrl: './device-list.html',
})
export class DeviceList {
  private readonly api = inject(Api);
  protected readonly store = inject(DeviceStore);

  protected readonly query = signal('');
  protected readonly typeFilter = signal<DeviceType | ''>('');
  protected readonly actionError = signal<string | null>(null);
  protected readonly busy = signal<ReadonlySet<string>>(new Set());

  protected readonly filtered = computed(() => {
    const query = this.query().trim().toLowerCase();
    const type = this.typeFilter();
    return this.store.devices().filter((d) => {
      if (type && d.type !== type) return false;
      if (!query) return true;
      return d.name.toLowerCase().includes(query) || identity(d).includes(query);
    });
  });

  protected readonly typeLabel = typeLabel;
  protected readonly identity = identity;
  protected readonly switchLabel = switchLabel;

  protected power(device: DeviceView, state: DeviceView['switches'][number]): string {
    const power = meterValues(state, Date.now(), meterActive(device, state)).power;
    return `${formatNumber(power, 1)} W`;
  }

  protected isBusy(device: DeviceView, index: number): boolean {
    return this.busy().has(`${device.id}:${index}`);
  }

  /** Nem optimista: a kapcsoló a szerver válasza szerint áll be. */
  protected toggle(event: Event, device: DeviceView, index: number, output: boolean): void {
    event.preventDefault();
    const key = `${device.id}:${index}`;
    this.busy.update((set) => new Set(set).add(key));
    this.actionError.set(null);
    this.api.setSwitch(device.id, index, !output).subscribe({
      next: (view) => {
        this.store.upsert(view);
        this.done(key);
      },
      error: (err) => {
        this.actionError.set(errorMessage(err));
        this.done(key);
      },
    });
  }

  protected setQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected setType(event: Event): void {
    this.typeFilter.set((event.target as HTMLSelectElement).value as DeviceType | '');
  }

  private done(key: string): void {
    this.busy.update((set) => {
      const next = new Set(set);
      next.delete(key);
      return next;
    });
  }
}
