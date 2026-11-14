import { randomBytes } from 'node:crypto';
import {
  type BrokerConnection,
  type BrokerConnectionStatus,
  SIMULATOR_STATUS_TOPIC,
} from '@iot-sim/shared';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { connect, type MqttClient } from 'mqtt';
import { type Observable, Subject, type Subscription } from 'rxjs';
import { BrokerService } from '../broker/broker.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { EventBus } from '../events/event-bus.service.js';
import { type MessageHandler, TopicRouter } from './topic-router.js';

const RECONNECT_PERIOD_MS = 5000;
const CONNECT_TIMEOUT_MS = 10_000;

export interface PublishOptions {
  retain?: boolean;
}

/**
 * A szimulátor egyetlen, közös MQTT-kapcsolata. Minden szimulált eszköz ezen
 * keresztül küld és fogad; a bejövő üzeneteket a TopicRouter osztja szét.
 */
@Injectable()
export class MqttGateway
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MqttGateway.name);
  private readonly router = new TopicRouter();
  private readonly connected = new Subject<void>();
  private readonly disconnected = new Subject<void>();
  private readonly clientId: string;

  private client: MqttClient | null = null;
  private state: BrokerConnection = { status: 'disconnected' };
  private settingsSubscription: Subscription | null = null;
  private lastLoggedError: string | null = null;

  /** Minden sikeres (újra)csatlakozás után jelez, a feliratkozások visszaállítása után. */
  readonly connected$: Observable<void> = this.connected.asObservable();
  /** Jelez, amikor az élő kapcsolat megszakad. */
  readonly disconnected$: Observable<void> = this.disconnected.asObservable();

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly broker: BrokerService,
    private readonly bus: EventBus,
  ) {
    this.clientId =
      config.mqttClientId ?? `iot-simulator-${randomBytes(4).toString('hex')}`;
  }

  get connection(): BrokerConnection {
    return this.state;
  }

  get isConnected(): boolean {
    return this.state.status === 'connected';
  }

  async onApplicationBootstrap(): Promise<void> {
    this.settingsSubscription = this.broker.changed$.subscribe(() => {
      void this.reconnect();
    });
    await this.open();
  }

  async onApplicationShutdown(): Promise<void> {
    this.settingsSubscription?.unsubscribe();
    await this.close();
  }

  /** A brokerbeállítás változása után: a régi kapcsolat lezárul, új épül. */
  async reconnect(): Promise<void> {
    await this.close();
    await this.open();
  }

  /**
   * Közzétesz egy üzenetet. Objektum JSON-ként megy ki. Hamisat ad, ha nincs
   * élő kapcsolat: ilyenkor az üzenet elvész, ahogy egy hálózat nélküli eszközé.
   */
  publish(
    topic: string,
    payload: string | object,
    options: PublishOptions = {},
  ): boolean {
    if (!this.client || !this.isConnected) return false;
    const body =
      typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.client.publish(topic, body, {
      qos: 0,
      retain: options.retain ?? false,
    });
    return true;
  }

  /** Feliratkozik egy mintára; a visszaadott függvény leiratkozik. */
  subscribe(pattern: string, handler: MessageHandler): () => void {
    if (this.router.add(pattern, handler) && this.isConnected) {
      this.client?.subscribe(pattern, { qos: 0 });
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.router.remove(pattern, handler) && this.isConnected) {
        this.client?.unsubscribe(pattern);
      }
    };
  }

  private async open(): Promise<void> {
    let options;
    try {
      options = this.broker.clientOptions(await this.broker.getSettings());
    } catch (err) {
      this.setState('error', (err as Error).message);
      return;
    }

    this.setState('connecting');
    const client = connect({
      ...options,
      clientId: this.clientId,
      clean: true,
      resubscribe: false,
      reconnectPeriod: RECONNECT_PERIOD_MS,
      connectTimeout: CONNECT_TIMEOUT_MS,
      will: {
        topic: SIMULATOR_STATUS_TOPIC,
        payload: 'offline',
        qos: 1,
        retain: true,
      },
    });
    this.client = client;

    client.on('connect', () => {
      if (this.client !== client) return;
      this.lastLoggedError = null;
      this.logger.log(
        `Csatlakozva a brokerhez: ${options.host}:${options.port}`,
      );
      client.publish(SIMULATOR_STATUS_TOPIC, 'online', {
        qos: 1,
        retain: true,
      });
      const patterns = this.router.patterns();
      if (patterns.length > 0) client.subscribe(patterns, { qos: 0 });
      this.setState('connected');
      this.connected.next();
    });

    client.on('message', (topic, payload) => {
      if (this.client !== client) return;
      this.router.dispatch(topic, payload);
    });

    client.on('error', (err) => {
      if (this.client !== client) return;
      const message = err.message || String(err);
      // Újrapróbálkozáskor ugyanaz a hiba 5 másodpercenként jönne: egyszer naplózzuk.
      if (message !== this.lastLoggedError) {
        this.logger.warn(`MQTT-hiba: ${message}`);
        this.lastLoggedError = message;
      }
      this.setState('error', message);
    });

    client.on('close', () => {
      if (this.client !== client) return;
      const wasConnected = this.isConnected;
      if (wasConnected) {
        this.logger.warn(
          'A brokerkapcsolat megszakadt, újracsatlakozás folyamatban.',
        );
        this.setState('disconnected');
        this.disconnected.next();
      }
    });
  }

  private async close(): Promise<void> {
    const client = this.client;
    if (!client) return;
    this.client = null;
    const wasConnected = this.isConnected;
    if (wasConnected) {
      client.publish(SIMULATOR_STATUS_TOPIC, 'offline', {
        qos: 1,
        retain: true,
      });
    }
    client.removeAllListeners();
    client.on('error', () => undefined);
    // Élő kapcsolatnál megvárjuk a sorban álló üzeneteket, különben azonnal bontunk.
    await client.endAsync(!wasConnected);
    this.setState('disconnected');
    if (wasConnected) this.disconnected.next();
  }

  private setState(status: BrokerConnectionStatus, error?: string): void {
    if (this.state.status === status && this.state.error === error) return;
    this.state = error === undefined ? { status } : { status, error };
    this.bus.emit({ type: 'broker.status', data: this.state });
  }
}
