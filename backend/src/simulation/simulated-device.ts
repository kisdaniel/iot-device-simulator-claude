import type { Device, MqttLogEntry } from '@iot-sim/shared';
import { Logger } from '@nestjs/common';
import type { EventBus } from '../events/event-bus.service.js';
import type {
  MqttGateway,
  PublishOptions,
} from '../mqtt/mqtt-gateway.service.js';
import type { DeviceProfile, ProfileContext } from './device-profile.js';

/**
 * Egy futó szimulált eszköz: állapot és profil, saját kapcsolat nélkül.
 * A közös kapcsolaton küld és fogad, és vezeti a saját üzenetnaplóját.
 */
export class SimulatedDevice {
  private readonly logger = new Logger(SimulatedDevice.name);
  private readonly log: MqttLogEntry[] = [];
  private readonly ctx: ProfileContext;
  private unsubscribers: Array<() => void> = [];
  private started = false;
  private online = false;

  constructor(
    readonly device: Device,
    private readonly profile: DeviceProfile,
    private readonly gateway: MqttGateway,
    private readonly bus: EventBus,
    private readonly logSize: number,
  ) {
    this.ctx = {
      device,
      publish: (topic, payload, options) =>
        this.publish(topic, payload, options),
    };
  }

  get isStarted(): boolean {
    return this.started;
  }

  get isOnline(): boolean {
    return this.online;
  }

  get messages(): readonly MqttLogEntry[] {
    return this.log;
  }

  /** Regisztrálja a feliratkozásokat; élő kapcsolatnál az eszköz azonnal be is jelentkezik. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribers = this.profile
      .subscriptions(this.device)
      .map((pattern) =>
        this.gateway.subscribe(pattern, (t, p) => this.receive(t, p)),
      );
    if (this.gateway.isConnected) this.announce();
  }

  /** Bejelentkezés: elérhető üzenet és kezdő állapot. Minden (újra)csatlakozás után lefut. */
  announce(): void {
    if (!this.started) return;
    this.guard('onStart', () => this.profile.onStart(this.ctx));
    this.setOnline(true);
  }

  /** A brokerkapcsolat megszakadt: az eszköz nem tud üzenni, de a feliratkozásai megmaradnak. */
  suspend(): void {
    this.setOnline(false);
  }

  /** Kiteszi a nem elérhető üzenetet, majd leiratkozik. */
  stop(): void {
    if (!this.started) return;
    if (this.online) this.guard('onStop', () => this.profile.onStop(this.ctx));
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.started = false;
    this.setOnline(false);
  }

  tick(now: Date): void {
    if (!this.online) return;
    this.guard('onTick', () => this.profile.onTick(this.ctx, now));
  }

  private receive(topic: string, payload: Buffer): void {
    if (!this.started) return;
    this.record('in', topic, payload.toString('utf8'), false);
    this.guard('onMessage', () =>
      this.profile.onMessage(this.ctx, topic, payload),
    );
  }

  private publish(
    topic: string,
    payload: string | object,
    options?: PublishOptions,
  ): boolean {
    const sent = this.gateway.publish(topic, payload, options);
    if (sent) {
      const body =
        typeof payload === 'string' ? payload : JSON.stringify(payload);
      this.record('out', topic, body, options?.retain ?? false);
    }
    return sent;
  }

  private record(
    direction: MqttLogEntry['direction'],
    topic: string,
    payload: string,
    retain: boolean,
  ): void {
    const entry: MqttLogEntry = {
      deviceId: this.device.id,
      ts: new Date().toISOString(),
      direction,
      topic,
      payload,
      retain,
    };
    if (this.logSize > 0) {
      this.log.push(entry);
      if (this.log.length > this.logSize)
        this.log.splice(0, this.log.length - this.logSize);
    }
    this.bus.emit({ type: 'mqtt.message', data: entry });
  }

  private setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    this.bus.emit({
      type: 'device.connection',
      data: { id: this.device.id, status: online ? 'online' : 'offline' },
    });
  }

  /** Egy hibás profil vagy üzenet nem állíthatja meg a többi eszközt. */
  private guard(stage: string, action: () => void): void {
    try {
      action();
    } catch (err) {
      this.logger.error(
        `${this.device.name} (${this.device.id}) – ${stage}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
