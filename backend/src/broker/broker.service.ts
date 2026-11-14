import { readFileSync } from 'node:fs';
import {
  type BrokerSettings,
  type BrokerTestResult,
  DEFAULT_BROKER_SETTINGS,
} from '@iot-sim/shared';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { connect, type IClientOptions } from 'mqtt';
import { type Observable, Subject } from 'rxjs';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { SettingsStore } from '../storage/settings.store.js';
import type { BrokerSettingsDto } from './broker.dto.js';

const SETTINGS_KEY = 'broker';
const TEST_TIMEOUT_MS = 5000;

@Injectable()
export class BrokerService {
  private readonly changed = new Subject<void>();

  /** Jelez, amikor a mentett brokerbeállítás megváltozott (a közös kapcsolat ekkor újraépül). */
  readonly changed$: Observable<void> = this.changed.asObservable();

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

  /** A beállítás jelszó nélkül, ahogy az API kiadja. */
  async getPublicSettings(): Promise<
    Omit<BrokerSettings, 'password'> & { hasPassword: boolean }
  > {
    const { password, ...rest } = await this.getSettings();
    return { ...rest, hasPassword: Boolean(password) };
  }

  async update(dto: BrokerSettingsDto): Promise<void> {
    if (this.managedByEnv) {
      throw new ConflictException(
        'A brokerbeállítás környezeti változóból (MQTT_URL) jön, ezért nem módosítható.',
      );
    }
    await this.settings.set(SETTINGS_KEY, await this.merge(dto));
    this.changed.next();
  }

  /** A broker címe export-formában, jelszó nélkül. */
  async exportSettings(): Promise<{ url: string; username: string | null }> {
    const settings = await this.getSettings();
    return {
      url: `${settings.tls ? 'mqtts' : 'mqtt'}://${settings.host}:${settings.port}`,
      username: settings.username,
    };
  }

  /**
   * Importált brokercím. Környezeti változós beállításnál figyelmen kívül marad; a
   * jelszó a fájlban nincs, ezért a tárolt jelszó megmarad. `dryRun` esetén csak
   * megmondja, mi történne.
   */
  async importSettings(
    broker: { url: string; username?: string | null },
    dryRun: boolean,
  ): Promise<'unchanged' | 'updated' | 'ignored'> {
    if (this.managedByEnv) return 'ignored';
    const url = new URL(broker.url);
    const tls = url.protocol === 'mqtts:';
    const next = {
      host: url.hostname,
      port: url.port ? Number(url.port) : tls ? 8883 : 1883,
      tls,
      username: broker.username || null,
    };
    const current = await this.getSettings();
    if (
      current.host === next.host &&
      current.port === next.port &&
      current.tls === next.tls &&
      current.username === next.username
    ) {
      return 'unchanged';
    }
    if (!dryRun)
      await this.update({ ...next, username: next.username ?? undefined });
    return 'updated';
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
