import { Component, computed, inject, input, signal } from '@angular/core';
import type { DeviceView, SwitchState } from '@iot-sim/shared';
import { Api, MeterInput, errorMessage } from '../core/api';
import { DeviceStore } from '../core/device-store';
import { formatEnergy, formatNumber, meterActive, meterValues } from './meter-values';

type NumberField = 'loadPower' | 'voltage' | 'powerFactor' | 'frequency' | 'energyTotalWh';

interface FieldSpec {
  min: number;
  max: number;
  label: string;
}

const FIELDS: Record<NumberField | 'currentOverride', FieldSpec> = {
  loadPower: { min: 0, max: 10_000, label: 'A terhelés 0 és 10 000 W közötti' },
  voltage: { min: 0, max: 300, label: 'A feszültség 0 és 300 V közötti' },
  currentOverride: { min: 0, max: 100, label: 'Az áramerősség 0 és 100 A közötti' },
  powerFactor: { min: 0, max: 1, label: 'A teljesítménytényező 0 és 1 közötti' },
  frequency: { min: 45, max: 65, label: 'A frekvencia 45 és 65 Hz közötti' },
  energyTotalWh: { min: 0, max: 1e12, label: 'A számláló nem lehet negatív' },
};

/**
 * Egy kapcsoló fogyasztásmérője: a mért értékek megadása és a jelentett értékek.
 * A mező Enterre vagy elhagyásakor küld; érvénytelen értéknél nem megy ki üzenet.
 */
@Component({
  selector: 'app-meter-editor',
  templateUrl: './meter-editor.html',
})
export class MeterEditor {
  private readonly api = inject(Api);
  private readonly store = inject(DeviceStore);

  readonly device = input.required<DeviceView>();
  readonly state = input.required<SwitchState>();
  /** A pillanat (ms), amelyre a számlálót léptetjük; a szülő másodpercenként frissíti. */
  readonly now = input.required<number>();

  protected readonly values = computed(() =>
    meterValues(this.state(), this.now(), meterActive(this.device(), this.state())),
  );
  /** A Tasmota egyetlen mérője az összes relét méri. */
  protected readonly wholeDevice = computed(
    () => this.device().type === 'tasmota' && this.device().switches.length > 1,
  );
  protected readonly invalid = signal<Partial<Record<string, string>>>({});
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly formatEnergy = formatEnergy;
  protected readonly formatNumber = formatNumber;

  protected fieldId(name: string): string {
    return `${this.device().id}-${this.state().index}-${name}`;
  }

  protected commit(field: NumberField, event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value.trim().replace(',', '.');
    // A számláló mezője üresen marad; csak kitöltve küld, utána újra kiürül.
    if (field === 'energyTotalWh' && raw === '') return this.clear(field);
    const value = Number(raw);
    const spec = FIELDS[field];
    if (raw === '' || !Number.isFinite(value) || value < spec.min || value > spec.max) {
      this.invalid.update((m) => ({ ...m, [field]: spec.label }));
      return;
    }
    this.clear(field);
    if (field === 'energyTotalWh') input.value = '';
    else if (value === this.state().meter?.[field]) return;
    this.send({ [field]: value });
  }

  /** Üres mező: az áramerősség a terhelésből és a feszültségből számolódik. */
  protected commitCurrent(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim().replace(',', '.');
    if (raw === '') {
      this.clear('currentOverride');
      if (this.state().meter?.currentOverride !== null) this.send({ currentOverride: null });
      return;
    }
    const value = Number(raw);
    const spec = FIELDS.currentOverride;
    if (!Number.isFinite(value) || value < spec.min || value > spec.max) {
      this.invalid.update((m) => ({ ...m, currentOverride: spec.label }));
      return;
    }
    this.clear('currentOverride');
    if (value === this.state().meter?.currentOverride) return;
    this.send({ currentOverride: value });
  }

  protected reset(): void {
    this.run(this.api.resetEnergy(this.device().id, this.state().index));
  }

  private send(patch: MeterInput): void {
    this.run(this.api.setMeter(this.device().id, this.state().index, patch));
  }

  private run(request: ReturnType<Api['setMeter']>): void {
    this.busy.set(true);
    this.error.set(null);
    request.subscribe({
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

  private clear(field: string): void {
    this.invalid.update((m) => {
      const next = { ...m };
      delete next[field];
      return next;
    });
  }
}
