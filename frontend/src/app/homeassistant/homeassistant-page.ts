import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  type DeviceView,
  HOMEASSISTANT_CONFIG_PATH,
  type HomeAssistantConfigResult,
} from '@iot-sim/shared';
import { Api, errorMessage, homeAssistantParams } from '../core/api';
import { DeviceStore } from '../core/device-store';
import { identity, typeLabel } from '../devices/device-labels';

/** A két megjelenített fájl: a Home Assistant konfiguráció és a hozzá tartozó compose. */
export type HomeAssistantView = 'config' | 'compose';

/**
 * Home Assistant MQTT-konfiguráció a felvett eszközökből, és egy docker-compose.yml
 * Home Assistanttel és Mosquittóval: kiválasztás, előnézet, másolás és letöltés. A fájlokat
 * a backend állítja elő; a felület megmutatja, hová kell menteni őket.
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
  protected readonly view = signal<HomeAssistantView>('config');

  /** Ide kell menteni a konfigurációt a docker-compose.yml mellé. */
  protected readonly configPath = HOMEASSISTANT_CONFIG_PATH;

  /** Az éppen látható fájl tartalma; ezt másolja a Másolás gomb. */
  protected readonly content = computed(() => {
    const result = this.result();
    if (!result) return '';
    return this.view() === 'compose' ? result.compose : result.yaml;
  });
  protected readonly canExport = computed(
    () => this.view() === 'compose' || (this.result()?.entityCount ?? 0) > 0,
  );

  protected readonly typeLabel = typeLabel;
  protected readonly identity = identity;

  protected readonly selectedIds = computed(() =>
    this.store
      .devices()
      .map((d) => d.id)
      .filter((id) => !this.excluded().has(id)),
  );
  protected readonly allSelected = computed(() => this.excluded().size === 0);

  /** A letöltés címe: a compose független a kiválasztástól, a konfiguráció követi. */
  protected readonly downloadUrl = computed(() => {
    if (this.view() === 'compose') return '/api/homeassistant/docker-compose.yml';
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
        // A compose nem függ a kiválasztástól, ezért az előző marad.
        const compose = untracked(() => this.result()?.compose) ?? '';
        this.result.set({ yaml: '', compose, deviceCount: 0, entityCount: 0, warnings: [] });
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

  protected show(view: HomeAssistantView): void {
    this.view.set(view);
    this.copied.set(false);
  }

  protected setIncludeDiscovered(event: Event): void {
    this.includeDiscovered.set((event.target as HTMLInputElement).checked);
  }

  protected async copy(): Promise<void> {
    const text = this.content();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.error.set('A vágólapra másolás nem sikerült; jelöld ki és másold kézzel.');
    }
  }
}
