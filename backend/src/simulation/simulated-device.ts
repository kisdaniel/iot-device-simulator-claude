import type { Device, DeviceRunStatus, MqttLogEntry } from '@iot-sim/shared';
import { Logger } from '@nestjs/common';
import type { EventBus } from '../events/event-bus.service.js';
import type { MessageHandler } from '../mqtt/topic-router.js';
import type {
  MqttGateway,
  PublishOptions,
} from '../mqtt/mqtt-gateway.service.js';
import type {
  ChangeSource,
  DeviceProfile,
  ProfileContext,
} from './device-profile.js';

export interface SimulatedDeviceOptions {
  gateway: MqttGateway;
  bus: EventBus;
  logSize: number;
  /** Az eszköz állapota megváltozott (kapcsoló, mérő): a tulajdonos ment és értesít. */
  onStateChange: (device: SimulatedDevice) => void;
}

/**
 * Egy szimulált eszköz: állapot és profil, saját kapcsolat nélkül. A közös
 * kapcsolaton küld és fogad, és vezeti a saját üzenetnaplóját. Profil nélkül
 * (még nem támogatott típus) csak az állapotot tartja, nem indul el.
 */
export class SimulatedDevice {
  private readonly logger = new Logger(SimulatedDevice.name);
  private readonly log: MqttLogEntry[] = [];
  private readonly ctx: ProfileContext;
  private readonly handler: MessageHandler = (topic, payload) =>
    this.receive(topic, payload);
  private unsubscribers: Array<() => void> = [];
  private started = false;
  private online = false;
  private startedAt = new Date();

  constructor(
    readonly device: Device,
    readonly profile: DeviceProfile | undefined,
    private readonly options: SimulatedDeviceOptions,
  ) {
    const ctx = {
      device,
      publish: (topic, payload, publishOptions) =>
        this.publish(topic, payload, publishOptions),
      setSwitch: (index, output, source) =>
        this.setSwitch(index, output, source),
    } as Omit<ProfileContext, 'startedAt'> as ProfileContext;
    // Élő érték: az eszköz minden indításkor újraindítja az üzemidőt.
    Object.defineProperty(ctx, 'startedAt', {
      get: () => this.startedAt,
      enumerable: true,
    });
    this.ctx = ctx;
  }

  get isStarted(): boolean {
    return this.started;
  }

  get status(): DeviceRunStatus {
    return this.online ? 'online' : 'offline';
  }

  get messages(): readonly MqttLogEntry[] {
    return this.log;
  }

  /** Regisztrálja a feliratkozásokat; élő kapcsolatnál az eszköz azonnal be is jelentkezik. */
  start(): void {
    if (this.started || !this.profile) return;
    this.started = true;
    this.startedAt = new Date();
    // Ugyanaz a kezelő minden mintán: így egy több mintára illeszkedő üzenet is egyszer érkezik.
    const patterns = [...new Set(this.profile.subscriptions(this.device))];
    this.unsubscribers = patterns.map((p) =>
      this.options.gateway.subscribe(p, this.handler),
    );
    if (this.options.gateway.isConnected) this.announce();
  }

  /** Bejelentkezés: elérhető üzenet és kezdő állapot. Minden (újra)csatlakozás után lefut. */
  announce(): void {
    if (!this.started || !this.profile) return;
    const profile = this.profile;
    this.guard('onStart', () => profile.onStart(this.ctx));
    this.setOnline(true);
  }

  /** A brokerkapcsolat megszakadt: az eszköz nem tud üzenni, de a feliratkozásai megmaradnak. */
  suspend(): void {
    this.setOnline(false);
  }

  /** Kiteszi a nem elérhető üzenetet, majd leiratkozik. */
  stop(): void {
    if (!this.started) return;
    const profile = this.profile;
    if (this.online && profile)
      this.guard('onStop', () => profile.onStop(this.ctx));
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.started = false;
    this.setOnline(false);
  }

  tick(now: Date): void {
    const profile = this.profile;
    if (!this.online || !profile) return;
    this.guard('onTick', () => profile.onTick(this.ctx, now));
  }

  /**
   * Kapcsoló állítása a felületről, MQTT-ről vagy időzítőből. Lekapcsolt eszközön
   * is működik (mint a fizikai gomb hálózat nélkül), csak üzenet nem megy ki.
   */
  setSwitch(index: number, output: boolean, source: ChangeSource): boolean {
    const state = this.device.switches.find((s) => s.index === index);
    if (!state) throw new RangeError(`Nincs ${index}. kapcsoló az eszközön.`);
    const before = structuredClone(state);
    state.output = output;
    state.source = source;
    const profile = this.profile;
    if (this.online && profile) {
      this.guard('onSwitchChanged', () =>
        profile.onSwitchChanged(this.ctx, index, before),
      );
    }
    this.options.onStateChange(this);
    return before.output;
  }

  private receive(topic: string, payload: Buffer): void {
    const profile = this.profile;
    if (!this.started || !profile) return;
    this.record('in', topic, payload.toString('utf8'), false);
    this.guard('onMessage', () => profile.onMessage(this.ctx, topic, payload));
  }

  private publish(
    topic: string,
    payload: string | object,
    options?: PublishOptions,
  ): boolean {
    const sent = this.options.gateway.publish(topic, payload, options);
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
    const size = this.options.logSize;
    if (size > 0) {
      this.log.push(entry);
      if (this.log.length > size) this.log.splice(0, this.log.length - size);
    }
    this.options.bus.emit({ type: 'mqtt.message', data: entry });
  }

  private setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    this.options.bus.emit({
      type: 'device.connection',
      data: { id: this.device.id, status: this.status },
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
