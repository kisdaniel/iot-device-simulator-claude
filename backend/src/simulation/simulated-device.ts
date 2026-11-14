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
  MeterPatch,
  ProfileContext,
  SensorPatch,
} from './device-profile.js';
import { commitDeviceEnergy, meterActive } from './meter.js';

export interface SimulatedDeviceOptions {
  gateway: MqttGateway;
  bus: EventBus;
  logSize: number;
  /** Az eszköz állapota megváltozott (kapcsoló, mérő): a tulajdonos ment és értesít. */
  onStateChange: (device: SimulatedDevice) => void;
  /** A profil módosította a konfigurációt: a tulajdonos ment és értesít. */
  onConfigChange: (device: SimulatedDevice) => void;
}

/**
 * Egy szimulált eszköz: állapot és profil, saját kapcsolat nélkül. A közös
 * kapcsolaton küld és fogad, és vezeti a saját üzenetnaplóját. Profil nélkül
 * (még nem támogatott típus) csak az állapotot tartja, nem indul el.
 */
export class SimulatedDevice {
  private readonly logger = new Logger(SimulatedDevice.name);
  private readonly log: MqttLogEntry[] = [];
  private readonly memory = new Map<string, unknown>();
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
      resetEnergy: (index) => this.resetEnergy(index),
      saveConfig: () => this.options.onConfigChange(this),
      memory: this.memory,
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
    this.memory.clear();
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

  /** Végleges törlés: a profil eltakarítja a megőrzött üzeneteit, majd leáll. */
  remove(): void {
    const profile = this.profile;
    if (profile?.onRemove && this.options.gateway.isConnected) {
      this.guard('onRemove', () => profile.onRemove!(this.ctx));
    }
    this.stop();
  }

  /** A konfiguráció megváltozott (`before`: a korábbi állapot). */
  reconfigured(before: Device, restarted: boolean): void {
    const profile = this.profile;
    if (profile?.onReconfigured && this.options.gateway.isConnected) {
      this.guard('onReconfigured', () =>
        profile.onReconfigured!(this.ctx, before, restarted),
      );
    }
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
    const state = this.switch(index);
    commitDeviceEnergy(this.device, new Date());
    const before = structuredClone(state);
    state.output = output;
    state.source = source;
    this.changed(index, before, 'onSwitchChanged');
    return before.output;
  }

  /** Mérőmezők állítása; a számláló előbb a régi teljesítménnyel rögzül. */
  setMeter(index: number, patch: MeterPatch): void {
    const state = this.switch(index);
    if (!state.meter)
      throw new RangeError(`A(z) ${index}. kapcsolónak nincs mérője.`);
    commitDeviceEnergy(this.device, new Date());
    const before = structuredClone(state);
    Object.assign(state.meter, patch);
    this.changed(index, before, 'onMeterChanged');
  }

  resetEnergy(index: number): number {
    const state = this.switch(index);
    if (!state.meter)
      throw new RangeError(`A(z) ${index}. kapcsolónak nincs mérője.`);
    commitDeviceEnergy(this.device, new Date());
    const before = structuredClone(state);
    state.meter.energyTotalWh = 0;
    state.meter.energyTodayWh = 0;
    state.meter.energyYesterdayWh = 0;
    this.changed(index, before, 'onMeterChanged');
    return before.meter!.energyTotalWh;
  }

  /** Hőmérő értéke vagy hibaállapota; lekapcsolt eszközön is állítható. */
  setSensor(index: number, patch: SensorPatch): void {
    const state = this.device.sensors.find((s) => s.index === index);
    if (!state) throw new RangeError(`Nincs ${index}. hőmérő az eszközön.`);
    const before = structuredClone(state);
    Object.assign(state, patch);
    const profile = this.profile;
    if (this.online && profile) {
      this.guard('onSensorChanged', () =>
        profile.onSensorChanged(this.ctx, index, before),
      );
    }
    this.options.onStateChange(this);
  }

  /** Rögzíti az összes számlálót a megadott pillanatig (mentés előtt). */
  commitEnergy(now: Date): void {
    commitDeviceEnergy(this.device, now);
  }

  /** Igaz, ha valamelyik kimenet éppen fogyaszt, azaz a számláló nő. */
  get isConsuming(): boolean {
    return this.device.switches.some(
      (s) => (s.meter?.loadPower ?? 0) > 0 && meterActive(this.device, s),
    );
  }

  private switch(index: number) {
    const state = this.device.switches.find((s) => s.index === index);
    if (!state) throw new RangeError(`Nincs ${index}. kapcsoló az eszközön.`);
    return state;
  }

  private changed(
    index: number,
    before: Device['switches'][number],
    hook: 'onSwitchChanged' | 'onMeterChanged',
  ): void {
    const profile = this.profile;
    if (this.online && profile) {
      this.guard(hook, () => profile[hook](this.ctx, index, before));
    }
    this.options.onStateChange(this);
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
