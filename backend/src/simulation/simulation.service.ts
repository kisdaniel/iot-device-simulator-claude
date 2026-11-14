import type { Device, DeviceRunStatus, MqttLogEntry } from '@iot-sim/shared';
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
import { DevicesService } from '../devices/devices.service.js';
import { EventBus } from '../events/event-bus.service.js';
import { MqttGateway } from '../mqtt/mqtt-gateway.service.js';
import { ProfileRegistry } from './profile-registry.js';
import { SimulatedDevice } from './simulated-device.js';

const TICK_MS = 1000;

/** A futó eszközpéldányok nyilvántartása, életciklusa és közös órája. */
@Injectable()
export class SimulationService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(SimulationService.name);
  private readonly devices = new Map<string, SimulatedDevice>();
  private readonly subscriptions: Subscription[] = [];
  private readonly warnedTypes = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly gateway: MqttGateway,
    private readonly bus: EventBus,
    private readonly profiles: ProfileRegistry,
    private readonly devicesService: DevicesService,
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
    for (const device of await this.devicesService.list()) this.load(device);
    // Egyetlen közös óra hívja az összes eszközt, nincs eszközönkénti időzítő.
    this.timer = setInterval(() => this.tick(new Date()), TICK_MS);
    this.timer.unref();
  }

  /** A kapcsolat bontása előtt minden aktív eszköz kiteszi a nem elérhető üzenetét. */
  beforeApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    for (const subscription of this.subscriptions) subscription.unsubscribe();
    for (const device of this.devices.values()) device.stop();
    this.devices.clear();
  }

  /** Betölt vagy lecserél egy eszközt; engedélyezett eszköz azonnal elindul. */
  load(device: Device): void {
    this.unload(device.id);
    const profile = this.profiles.get(device.type);
    if (!profile) {
      if (!this.warnedTypes.has(device.type)) {
        this.warnedTypes.add(device.type);
        this.logger.warn(
          `Nincs profil a(z) "${device.type}" típushoz, az ilyen eszközök nem indulnak el.`,
        );
      }
      return;
    }
    const simulated = new SimulatedDevice(
      device,
      profile,
      this.gateway,
      this.bus,
      this.config.messageLogSize,
    );
    this.devices.set(device.id, simulated);
    if (device.enabled) simulated.start();
  }

  /** Leállít és eltávolít egy eszközt; igazat ad, ha létezett. */
  unload(id: string): boolean {
    const existing = this.devices.get(id);
    if (!existing) return false;
    existing.stop();
    this.devices.delete(id);
    return true;
  }

  status(id: string): DeviceRunStatus | undefined {
    const device = this.devices.get(id);
    if (!device) return undefined;
    return device.isOnline ? 'online' : 'offline';
  }

  messages(id: string): readonly MqttLogEntry[] | undefined {
    return this.devices.get(id)?.messages;
  }

  /** A közös óra egy ütése; a tesztek közvetlenül is hívhatják. */
  tick(now: Date): void {
    for (const device of this.devices.values()) device.tick(now);
  }
}
