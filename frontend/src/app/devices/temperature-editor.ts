import { Component, computed, inject, input, signal } from '@angular/core';
import {
  type DeviceView,
  SHELLY_ADDON_FIRST_ID,
  type SetSensorRequest,
  TEMPERATURE_MAX_C,
  TEMPERATURE_MIN_C,
  type TemperatureState,
} from '@iot-sim/shared';
import { Api, errorMessage } from '../core/api';
import { DeviceStore } from '../core/device-store';

/**
 * Egy DS18B20 hőmérő: érték mezővel és csúszkával, valamint szenzorhiba.
 * A csúszka húzás közben csak a kijelzést frissíti; elengedéskor küld.
 */
@Component({
  selector: 'app-temperature-editor',
  templateUrl: './temperature-editor.html',
})
export class TemperatureEditor {
  private readonly api = inject(Api);
  private readonly store = inject(DeviceStore);

  readonly device = input.required<DeviceView>();
  readonly state = input.required<TemperatureState>();

  protected readonly min = TEMPERATURE_MIN_C;
  protected readonly max = TEMPERATURE_MAX_C;
  /** Húzás közbeni érték; null, ha a szerver szerinti értéket mutatjuk. */
  protected readonly dragging = signal<number | null>(null);
  protected readonly invalid = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly componentId = computed(() => SHELLY_ADDON_FIRST_ID + this.state().index);
  protected readonly shown = computed(() => this.dragging() ?? this.state().tC ?? 0);
  protected readonly fahrenheit = computed(
    () => Math.round(((this.shown() * 9) / 5) * 10 + 320) / 10,
  );

  protected fieldId(name: string): string {
    return `${this.device().id}-t${this.state().index}-${name}`;
  }

  protected drag(event: Event): void {
    this.dragging.set(Number((event.target as HTMLInputElement).value));
  }

  protected commit(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim().replace(',', '.');
    const value = Number(raw);
    this.dragging.set(null);
    if (raw === '' || !Number.isFinite(value) || value < this.min || value > this.max) {
      this.invalid.set(true);
      return;
    }
    this.invalid.set(false);
    if (Math.round(value * 10) / 10 === this.state().tC) return;
    this.send({ tC: value });
  }

  protected toggleError(event: Event): void {
    const failing = (event.target as HTMLInputElement).checked;
    this.send({ error: failing ? 'read' : null });
  }

  private send(body: SetSensorRequest): void {
    this.busy.set(true);
    this.error.set(null);
    this.api.setSensor(this.device().id, this.state().index, body).subscribe({
      next: (view) => {
        this.store.upsert(view);
        this.busy.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err));
        this.busy.set(false);
      },
    });
  }
}
