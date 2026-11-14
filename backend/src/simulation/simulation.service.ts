import type { Device, DeviceView, MqttLogEntry } from '@iot-sim/shared';
import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { Subscription } from 'rxjs';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { EventBus } from '../events/event-bus.service.js';
import { MqttGateway } from '../mqtt/mqtt-gateway.service.js';
import { DeviceStore } from '../storage/device.store.js';
import type { ChangeSource } from './device-profile.js';
import { ProfileRegistry } from './profile-registry.js';
import { SimulatedDevice } from './simulated-device.js';

const TICK_MS = 1000;

/**
 * A futó eszközök nyilvántartása, életciklusa és közös órája. Minden tárolt
 * eszköz itt él; a futási állapot (kapcsolók, mérők) innen kerül az adatbázisba.
 */
@Injectable()
export class SimulationService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(SimulationService.name);
  private readonly devices = new Map<string, SimulatedDevice>();
  private readonly subscriptions: Subscription[] = [];
  private readonly warnedTypes = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  /** Az állapotmentések sorban futnak, hogy a későbbi ne előzhesse meg a korábbit. */
  private writes: Promise<void> = Promise.resolve();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly gateway: MqttGateway,
    private readonly bus: EventBus,
    private readonly profiles: ProfileRegistry,
    private readonly store: DeviceStore,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.subscriptions.push(
      this.gateway.connected$.subscribe(() => {
        for (const device of this.devices.values()) device.announce();
      }),
      this.gateway.disconnected$.subscribe(() => {
        for (const device of this.devices.values()) device.suspend();
      }),
    );
    for (const device of await this.store.list()) this.load(device);
    // Egyetlen közös óra hívja az összes eszközt, nincs eszközönkénti időzítő.
    this.timer = setInterval(() => this.tick(new Date()), TICK_MS);
    this.timer.unref();
  }

  /** A kapcsolat bontása előtt minden aktív eszköz kiteszi a nem elérhető üzenetét. */
  async beforeApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    for (const subscription of this.subscriptions) subscription.unsubscribe();
    for (const device of this.devices.values()) device.stop();
    this.devices.clear();
    await this.writes;
  }

  list(): DeviceView[] {
    return [...this.devices.values()].map((d) => this.view(d));
  }

  get(id: string): DeviceView | undefined {
    const device = this.devices.get(id);
    return device ? this.view(device) : undefined;
  }

  /**
   * Betölt vagy lecserél egy eszközt; engedélyezett eszköz azonnal elindul.
   * A lecserélt eszköz előbb kijelentkezik; a sorrend a listában megmarad.
   */
  load(device: Device): DeviceView {
    this.devices.get(device.id)?.stop();
    const profile = this.profiles.get(device.type);
    if (!profile && !this.warnedTypes.has(device.type)) {
      this.warnedTypes.add(device.type);
      this.logger.warn(
        `Nincs profil a(z) "${device.type}" típushoz, az ilyen eszközök nem indulnak el.`,
      );
    }
    const simulated = new SimulatedDevice(device, profile, {
      gateway: this.gateway,
      bus: this.bus,
      logSize: this.config.messageLogSize,
      onStateChange: (d) => this.stateChanged(d),
    });
    this.devices.set(device.id, simulated);
    if (device.enabled) simulated.start();
    return this.view(simulated);
  }

  /**
   * Konfigurációváltozás: ha a feliratkozások változnak (pl. új topic-előtag),
   * az eszköz újraindul, különben helyben frissül, ki- és bejelentkezés nélkül.
   */
  reconfigure(device: Device): DeviceView {
    const current = this.devices.get(device.id);
    const profile = current?.profile;
    if (
      !current ||
      !profile ||
      current.device.enabled !== device.enabled ||
      JSON.stringify(profile.subscriptions(current.device)) !==
        JSON.stringify(profile.subscriptions(device))
    ) {
      return this.load(device);
    }
    Object.assign(current.device, {
      name: device.name,
      shelly: device.shelly,
      tasmota: device.tasmota,
    });
    return this.view(current);
  }

  /** Leállít és eltávolít egy eszközt; igazat ad, ha létezett. */
  unload(id: string): boolean {
    const existing = this.devices.get(id);
    if (!existing) return false;
    existing.stop();
    this.devices.delete(id);
    return true;
  }

  setSwitch(
    id: string,
    index: number,
    output: boolean,
    source: ChangeSource,
  ): DeviceView {
    const device = this.require(id);
    device.setSwitch(index, output, source);
    return this.view(device);
  }

  messages(id: string): readonly MqttLogEntry[] | undefined {
    return this.devices.get(id)?.messages;
  }

  /** A közös óra egy ütése; a tesztek közvetlenül is hívhatják. */
  tick(now: Date): void {
    for (const device of this.devices.values()) device.tick(now);
  }

  /** Megvárja a folyamatban lévő állapotmentéseket (tesztekhez és leálláshoz). */
  flush(): Promise<void> {
    return this.writes;
  }

  private view(device: SimulatedDevice): DeviceView {
    return { ...structuredClone(device.device), status: device.status };
  }

  private require(id: string): SimulatedDevice {
    const device = this.devices.get(id);
    if (!device)
      throw new RangeError(`Nincs eszköz ezzel az azonosítóval: ${id}`);
    return device;
  }

  private stateChanged(device: SimulatedDevice): void {
    const snapshot = structuredClone(device.device);
    this.writes = this.writes
      .then(() => this.store.saveSwitches(snapshot))
      .catch((err: Error) => {
        this.logger.error(
          `Az állapot mentése nem sikerült (${snapshot.id}): ${err.message}`,
        );
      });
    this.bus.emit({ type: 'device.updated', data: this.view(device) });
  }
}
