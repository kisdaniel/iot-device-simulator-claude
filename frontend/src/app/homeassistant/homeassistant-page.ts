import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  type ComposeOptions,
  DEFAULT_COMPOSE_OPTIONS,
  type DeviceView,
  HOMEASSISTANT_CONFIG_PATH,
  HOMEASSISTANT_DATA_DIR,
  type HomeAssistantComposeResult,
  type HomeAssistantConfigResult,
  MOSQUITTO_DATA_DIR,
  NODERED_DATA_DIR,
  SIMULATOR_DATA_DIR,
} from '@iot-sim/shared';
import { Api, errorMessage, homeAssistantParams } from '../core/api';
import { DeviceStore } from '../core/device-store';
import { identity, typeLabel } from '../devices/device-labels';
import { ComposeOptionsForm } from './compose-options-form';

/** Ennyi ms-ot vár a compose előnézete a beállítások utolsó változása után. */
export const COMPOSE_DEBOUNCE_MS = 300;

/** A két megjelenített fájl: a Home Assistant konfiguráció és a hozzá tartozó compose. */
export type HomeAssistantView = 'config' | 'compose';

/**
 * Home Assistant MQTT-konfiguráció a felvett eszközökből, és egy docker-compose.yml
 * Home Assistanttel, valamint választhatóan Mosquittóval, Node-RED-del és magával a
 * szimulátorral: kiválasztás, beállítások, előnézet, másolás és letöltés. A fájlokat a
 * backend állítja elő; a felület megmutatja, hová kell menteni őket.
 */
@Component({
  selector: 'app-homeassistant-page',
  imports: [RouterLink, ComposeOptionsForm],
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

  /** A compose beállításai; null, ha az űrlap valamelyik mezője hibás. */
  protected readonly composeOptions = signal<ComposeOptions | null>(DEFAULT_COMPOSE_OPTIONS);
  protected readonly composeResult = signal<HomeAssistantComposeResult | null>(null);
  protected readonly composeError = signal<string | null>(null);

  /** Az éppen látható fájl tartalma; ezt másolja a Másolás gomb. */
  protected readonly content = computed(() =>
    this.view() === 'compose' ? (this.composeResult()?.compose ?? '') : (this.result()?.yaml ?? ''),
  );
  protected readonly canExport = computed(() =>
    this.view() === 'compose'
      ? this.composeOptions() !== null && this.composeResult() !== null
      : (this.result()?.entityCount ?? 0) > 0,
  );
  protected readonly warnings = computed(() =>
    this.view() === 'compose'
      ? (this.composeResult()?.warnings ?? [])
      : (this.result()?.warnings ?? []),
  );

  /** A compose melletti mappák, ahová az adatok kerülnek. */
  protected readonly dataFolders = computed(() => {
    const options = this.composeOptions() ?? DEFAULT_COMPOSE_OPTIONS;
    return [
      HOMEASSISTANT_DATA_DIR,
      ...(options.mosquitto.enabled ? [MOSQUITTO_DATA_DIR] : []),
      ...(options.nodeRed.enabled ? [NODERED_DATA_DIR] : []),
      ...(options.simulator.enabled ? [SIMULATOR_DATA_DIR] : []),
    ].map((folder) => `${folder}/`);
  });

  protected readonly typeLabel = typeLabel;
  protected readonly identity = identity;

  protected readonly selectedIds = computed(() =>
    this.store
      .devices()
      .map((d) => d.id)
      .filter((id) => !this.excluded().has(id)),
  );
  protected readonly allSelected = computed(() => this.excluded().size === 0);

  /** A konfiguráció letöltésének címe a kiválasztás szerint (a compose POST-tal töltődik le). */
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

    // A compose a beállítások változására, rövid várakozás után frissül, hogy ne
    // menjen kérés minden leütésre. Hibás beállításnál az előző előnézet marad, de
    // a másolás és a letöltés tiltva van.
    effect((onCleanup) => {
      const options = this.composeOptions();
      if (!options) return;
      const timer = setTimeout(() => {
        this.api.homeAssistantCompose(options).subscribe({
          next: (result) => {
            this.composeResult.set(result);
            this.composeError.set(null);
          },
          error: (err) => this.composeError.set(errorMessage(err)),
        });
      }, COMPOSE_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  /** A compose letöltése: POST, mert a beállítások jelszót is tartalmazhatnak. */
  protected downloadCompose(): void {
    const options = this.composeOptions();
    if (!options) return;
    this.api.homeAssistantComposeFile(options).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'docker-compose.yml';
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (err) => this.composeError.set(errorMessage(err)),
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
