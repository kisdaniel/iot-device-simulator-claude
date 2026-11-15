import { Component, computed, effect, inject, output, signal } from '@angular/core';
import {
  type BrokerSettingsView,
  type ComposeOptions,
  SIMULATOR_DEFAULT_IMAGE,
  SIMULATOR_SEED_PATH,
} from '@iot-sim/shared';
import { Api } from '../core/api';

/** Az űrlap mezői; a jelszavak csak itt, memóriában élnek, a böngésző tárolójába nem kerülnek. */
export interface ComposeFormState {
  mosquitto: boolean;
  auth: boolean;
  authUsername: string;
  authPassword: string;
  brokerHost: string;
  brokerPort: number | null;
  brokerUsername: string;
  brokerPassword: string;
  nodeRed: boolean;
  simulator: boolean;
  simulatorImage: string;
  seedDevices: boolean;
}

export const INITIAL_COMPOSE_FORM: ComposeFormState = {
  mosquitto: true,
  auth: false,
  authUsername: '',
  authPassword: '',
  brokerHost: '',
  brokerPort: 1883,
  brokerUsername: '',
  brokerPassword: '',
  nodeRed: false,
  simulator: false,
  simulatorImage: SIMULATOR_DEFAULT_IMAGE,
  seedDevices: false,
};

/** Az űrlap eredménye: a beállítások, vagy mezőnként a hibák. */
export type ComposeFormResult =
  | { options: ComposeOptions; errors: Record<string, never> }
  | { options: null; errors: Partial<Record<keyof ComposeFormState, string>> };

const USERNAME = /^[^\s:]+$/;
// Szándékosan vezérlőkaraktert keres: a sortörés elrontaná a jelszófájlt.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$|^\[[0-9A-Fa-f:.]+\]$/;
const IMAGE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*(:[A-Za-z0-9._-]+)?(@sha256:[0-9a-f]{64})?$/;

/** A mezőkből a backend ComposeOptions-e; ugyanazok a szabályok, mint a backendben. */
export function composeFormResult(state: ComposeFormState): ComposeFormResult {
  const errors: Partial<Record<keyof ComposeFormState, string>> = {};
  const username = (field: keyof ComposeFormState, value: string, required: boolean) => {
    if (!value) {
      if (required) errors[field] = 'A felhasználónév kötelező.';
    } else if (!USERNAME.test(value) || value.length > 64) {
      errors[field] = 'Legfeljebb 64 karakter, szóköz és kettőspont nélkül.';
    }
  };
  const password = (field: keyof ComposeFormState, value: string, required: boolean) => {
    if (!value) {
      if (required) errors[field] = 'A jelszó kötelező.';
    } else if (CONTROL.test(value) || value.length > 128) {
      errors[field] = 'Legfeljebb 128 karakter, sortörés nélkül.';
    }
  };

  if (state.mosquitto && state.auth) {
    username('authUsername', state.authUsername.trim(), true);
    password('authPassword', state.authPassword, true);
  }
  if (!state.mosquitto) {
    const host = state.brokerHost.trim();
    if (!host) errors.brokerHost = 'A broker címe kötelező.';
    else if (!HOST.test(host) || host.length > 253) errors.brokerHost = 'Gépnév vagy IP-cím kell.';
    const port = state.brokerPort;
    if (port === null || !Number.isInteger(port) || port < 1 || port > 65535) {
      errors.brokerPort = 'A port 1 és 65535 közötti egész szám.';
    }
    username('brokerUsername', state.brokerUsername.trim(), false);
    password('brokerPassword', state.brokerPassword, false);
  }
  if (state.simulator) {
    const image = state.simulatorImage.trim();
    if (!IMAGE.test(image) || image.length > 255) {
      errors.simulatorImage = 'Érvényes képnév kell, pl. iot-device-simulator:latest.';
    }
  }
  if (Object.keys(errors).length > 0) return { options: null, errors };

  return {
    errors: {},
    options: {
      mosquitto: {
        enabled: state.mosquitto,
        auth:
          state.mosquitto && state.auth
            ? { username: state.authUsername.trim(), password: state.authPassword }
            : null,
      },
      broker: state.mosquitto
        ? null
        : {
            host: state.brokerHost.trim(),
            port: state.brokerPort!,
            username: state.brokerUsername.trim() || null,
            password: state.brokerPassword || null,
          },
      nodeRed: { enabled: state.nodeRed },
      simulator: {
        enabled: state.simulator,
        image: state.simulatorImage.trim(),
        seedDevices: state.simulator && state.seedDevices,
      },
    },
  };
}

/**
 * A szimulátor brokerbeállításából a külső broker előtöltése. A konténerekből a
 * `localhost` a konténert jelenti, ezért a gép saját címe helyett `host.docker.internal`.
 */
export function brokerPrefill(
  broker: BrokerSettingsView,
): Pick<ComposeFormState, 'brokerHost' | 'brokerPort' | 'brokerUsername'> {
  const local = ['localhost', '127.0.0.1', '::1'].includes(broker.host);
  return {
    brokerHost: local ? 'host.docker.internal' : broker.host,
    brokerPort: broker.port,
    brokerUsername: broker.username ?? '',
  };
}

/** A generált docker-compose.yml beállításai a Home Assistant oldal compose fülén. */
@Component({
  selector: 'app-compose-options-form',
  templateUrl: './compose-options-form.html',
})
export class ComposeOptionsForm {
  private readonly api = inject(Api);

  protected readonly state = signal<ComposeFormState>({ ...INITIAL_COMPOSE_FORM });
  protected readonly result = computed(() => composeFormResult(this.state()));
  protected readonly errors = computed(
    () => this.result().errors as Partial<Record<keyof ComposeFormState, string>>,
  );
  protected readonly seedPath = SIMULATOR_SEED_PATH;

  /** Minden változáskor: az érvényes beállítások, vagy null, ha valamelyik mező hibás. */
  readonly optionsChange = output<ComposeOptions | null>();

  constructor() {
    this.api.getBroker().subscribe({
      next: (broker) => this.state.update((s) => ({ ...s, ...brokerPrefill(broker) })),
      error: () => undefined,
    });
    effect(() => this.optionsChange.emit(this.result().options));
  }

  protected setFlag(field: keyof ComposeFormState, event: Event): void {
    const value = (event.target as HTMLInputElement).checked;
    this.state.update((s) => ({ ...s, [field]: value }));
  }

  protected setText(field: keyof ComposeFormState, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.state.update((s) => ({ ...s, [field]: value }));
  }

  protected setPort(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.state.update((s) => ({ ...s, brokerPort: raw === '' ? null : Number(raw) }));
  }
}
