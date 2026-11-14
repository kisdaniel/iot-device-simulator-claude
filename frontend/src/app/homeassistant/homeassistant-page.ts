import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { DeviceView, HomeAssistantConfigResult } from '@iot-sim/shared';
import { Api, errorMessage, homeAssistantParams } from '../core/api';
import { DeviceStore } from '../core/device-store';
import { identity, typeLabel } from '../devices/device-labels';

/**
 * Home Assistant MQTT-konfiguráció a felvett eszközökből: kiválasztás, előnézet,
 * másolás és letöltés. A YAML-t a backend állítja elő, a felület csak megjeleníti.
 */
@Component({
  selector: 'app-homeassistant-page',
  imports: [RouterLink],
  templateUrl: './homeassistant-page.html',
})
export class HomeAssistantPage {
  private readonly api = inject(Api);
  protected readonly store = inject(DeviceStore);

  /** A kizárt eszközök; alapból minden eszköz benne van, az újak is. */
  protected readonly excluded = signal<ReadonlySet<string>>(new Set());
  protected readonly includeDiscovered = signal(false);
  protected readonly result = signal<HomeAssistantConfigResult | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly copied = signal(false);

  protected readonly typeLabel = typeLabel;
  protected readonly identity = identity;

  protected readonly selectedIds = computed(() =>
    this.store
      .devices()
      .map((d) => d.id)
      .filter((id) => !this.excluded().has(id)),
  );
  protected readonly allSelected = computed(() => this.excluded().size === 0);

  /** A letöltés címe a kiválasztás szerint. */
  protected readonly downloadUrl = computed(() => {
    const params = new URLSearchParams(
      homeAssistantParams(this.allSelected() ? null : this.selectedIds(), this.includeDiscovered()),
    ).toString();
    return `/api/homeassistant/config.yaml${params ? `?${params}` : ''}`;
  });

  constructor() {
    // Minden változásra (kiválasztás, eszközök, beállítások) újragenerál.
    effect(() => {
      if (!this.store.loaded()) return;
      const ids = this.allSelected() ? null : this.selectedIds();
      if (ids?.length === 0) {
        // Üres ids paraméter a backendnek „minden eszközt” jelentene.
        this.result.set({ yaml: '', deviceCount: 0, entityCount: 0, warnings: [] });
        this.error.set(null);
        return;
      }
      this.api.homeAssistantConfig(ids, this.includeDiscovered()).subscribe({
        next: (result) => {
          this.result.set(result);
          this.error.set(null);
        },
        error: (err) => this.error.set(errorMessage(err)),
      });
    });
  }

  protected isSelected(device: DeviceView): boolean {
    return !this.excluded().has(device.id);
  }

  protected toggle(device: DeviceView): void {
    this.excluded.update((set) => {
      const next = new Set(set);
      if (next.has(device.id)) next.delete(device.id);
      else next.add(device.id);
      return next;
    });
  }

  protected selectAll(selected: boolean): void {
    this.excluded.set(selected ? new Set() : new Set(this.store.devices().map((d) => d.id)));
  }

  protected setIncludeDiscovered(event: Event): void {
    this.includeDiscovered.set((event.target as HTMLInputElement).checked);
  }

  protected async copy(): Promise<void> {
    const yaml = this.result()?.yaml;
    if (!yaml) return;
    try {
      await navigator.clipboard.writeText(yaml);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.error.set('A vágólapra másolás nem sikerült; jelöld ki és másold kézzel.');
    }
  }
}
