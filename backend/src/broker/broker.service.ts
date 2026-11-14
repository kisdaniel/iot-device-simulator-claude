import { readFileSync } from 'node:fs';
import {
  type BrokerSettings,
  type BrokerSettingsView,
  type BrokerTestResult,
  DEFAULT_BROKER_SETTINGS,
} from '@iot-sim/shared';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { connect, type IClientOptions } from 'mqtt';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { SettingsStore } from '../storage/settings.store.js';
import type { BrokerSettingsDto } from './broker.dto.js';

const SETTINGS_KEY = 'broker';
const TEST_TIMEOUT_MS = 5000;

@Injectable()
export class BrokerService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly settings: SettingsStore,
  ) {}

  /** A környezeti változó elsőbbséget élvez az adatbázisban tárolt beállítással szemben. */
  get managedByEnv(): boolean {
    return this.config.mqtt !== null;
  }

  async getSettings(): Promise<BrokerSettings> {
    if (this.config.mqtt) return this.config.mqtt;
    return (
      (await this.settings.get<BrokerSettings>(SETTINGS_KEY)) ??
      DEFAULT_BROKER_SETTINGS
    );
  }

  async getView(): Promise<BrokerSettingsView> {
    const { password, ...rest } = await this.getSettings();
    return {
      ...rest,
      hasPassword: Boolean(password),
      managedByEnv: this.managedByEnv,
    };
  }

  async update(dto: BrokerSettingsDto): Promise<BrokerSettingsView> {
    if (this.managedByEnv) {
      throw new ConflictException(
        'A brokerbeállítás környezeti változóból (MQTT_URL) jön, ezért nem módosítható.',
      );
    }
    await this.settings.set(SETTINGS_KEY, await this.merge(dto));
    return this.getView();
  }

  /** Próbakapcsolat a megadott beállítással, mentés nélkül. */
  async test(dto: BrokerSettingsDto): Promise<BrokerTestResult> {
    return this.tryConnect(await this.merge(dto));
  }

  /** A kérésből hiányzó jelszó helyére a tárolt jelszó kerül. */
  private async merge(dto: BrokerSettingsDto): Promise<BrokerSettings> {
    const current = await this.getSettings();
    return {
      host: dto.host,
      port: dto.port,
      tls: dto.tls,
      username: dto.username || null,
      password:
        dto.password === undefined ? current.password : dto.password || null,
    };
  }

  /** Az MQTT kliens beállításai a közös kapcsolathoz és a próbakapcsolathoz. */
  clientOptions(settings: BrokerSettings): IClientOptions {
    return {
      protocol: settings.tls ? 'mqtts' : 'mqtt',
      host: settings.host,
      port: settings.port,
      username: settings.username ?? undefined,
      password: settings.password ?? undefined,
      rejectUnauthorized: this.config.mqttRejectUnauthorized,
      ca: this.config.mqttCaFile
        ? readFileSync(this.config.mqttCaFile)
        : undefined,
    };
  }

  private tryConnect(settings: BrokerSettings): Promise<BrokerTestResult> {
    return new Promise((resolve) => {
      let options: IClientOptions;
      try {
        options = this.clientOptions(settings);
      } catch (err) {
        resolve({ ok: false, error: (err as Error).message });
        return;
      }
      const client = connect({
        ...options,
        clientId: `iot-simulator-test-${Math.random().toString(16).slice(2, 10)}`,
        reconnectPeriod: 0,
        connectTimeout: TEST_TIMEOUT_MS,
      });
      const finish = (result: BrokerTestResult) => {
        client.removeAllListeners();
        client.on('error', () => undefined);
        client.end(true);
        resolve(result);
      };
      client.once('connect', () => finish({ ok: true }));
      client.once('error', (err) => finish({ ok: false, error: err.message }));
      client.once('close', () =>
        finish({ ok: false, error: 'A broker nem érhető el.' }),
      );
    });
  }
}
