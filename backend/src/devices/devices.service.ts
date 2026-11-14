import { randomBytes, randomUUID } from 'node:crypto';
import {
  type Device,
  type DeviceView,
  type MqttLogEntry,
  SHELLY_SWITCH_COUNT,
  type ShellyConfig,
  shellyDeviceId,
  shellyTopicPrefix,
} from '@iot-sim/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventBus } from '../events/event-bus.service.js';
import { defaultMeter } from '../simulation/meter.js';
import { SimulationService } from '../simulation/simulation.service.js';
import { DeviceStore } from '../storage/device.store.js';
import type { CreateDeviceDto, UpdateDeviceDto } from './devices.dto.js';

/** Eszközkezelés: a tárolás és a futó szimuláció összehangolása. */
@Injectable()
export class DevicesService {
  constructor(
    private readonly store: DeviceStore,
    private readonly simulation: SimulationService,
    private readonly bus: EventBus,
  ) {}

  list(): DeviceView[] {
    return this.simulation.list();
  }

  get(id: string): DeviceView {
    const device = this.simulation.get(id);
    if (!device)
      throw new NotFoundException(`Nincs eszköz ezzel az azonosítóval: ${id}`);
    return device;
  }

  async create(dto: CreateDeviceDto): Promise<DeviceView> {
    const now = new Date();
    const mac = (
      dto.shelly.mac ?? randomBytes(6).toString('hex')
    ).toLowerCase();
    const config: ShellyConfig = {
      generation: dto.shelly.generation,
      deviceId: shellyDeviceId(dto.type, dto.shelly.generation, mac),
      topicPrefix: dto.shelly.topicPrefix || null,
      rpcNtf: dto.shelly.rpcNtf ?? true,
      statusNtf: dto.shelly.statusNtf ?? true,
      enableControl: dto.shelly.enableControl ?? true,
      addon: { enabled: false, sensorCount: 0 },
    };
    this.assertUnique(config);

    const device: Device = {
      id: randomUUID(),
      name: dto.name.trim(),
      type: dto.type,
      enabled: dto.enabled ?? true,
      shelly: config,
      switches: Array.from(
        { length: SHELLY_SWITCH_COUNT[dto.type] },
        (_, index) => ({
          index,
          output: false,
          source: 'init',
          meter: defaultMeter(now),
        }),
      ),
      sensors: [],
    };
    await this.store.insert(device);
    return this.publish(this.simulation.load(device));
  }

  async update(id: string, dto: UpdateDeviceDto): Promise<DeviceView> {
    const current = this.get(id);
    const { status: _status, ...device } = current;
    if (dto.name !== undefined) device.name = dto.name.trim();
    if (dto.shelly) {
      if (!device.shelly)
        throw new BadRequestException('Az eszköz nem Shelly eszköz.');
      const { topicPrefix, rpcNtf, statusNtf, enableControl } = dto.shelly;
      device.shelly = {
        ...device.shelly,
        ...(topicPrefix !== undefined
          ? { topicPrefix: topicPrefix || null }
          : {}),
        ...(rpcNtf !== undefined ? { rpcNtf } : {}),
        ...(statusNtf !== undefined ? { statusNtf } : {}),
        ...(enableControl !== undefined ? { enableControl } : {}),
      };
      this.assertUnique(device.shelly, id);
    }
    await this.store.update(device);
    return this.publish(this.simulation.reconfigure(device));
  }

  /** Lekapcsolás vagy visszakapcsolás (kiesés szimulációja). */
  async setEnabled(id: string, enabled: boolean): Promise<DeviceView> {
    const { status: _status, ...device } = this.get(id);
    if (device.enabled === enabled) return this.get(id);
    device.enabled = enabled;
    await this.store.update(device);
    return this.publish(this.simulation.load(device));
  }

  async remove(id: string): Promise<void> {
    this.get(id);
    this.simulation.unload(id);
    await this.simulation.flush();
    await this.store.delete(id);
    this.bus.emit({ type: 'device.removed', data: { id } });
  }

  setSwitch(id: string, index: number, output: boolean | 'toggle'): DeviceView {
    const device = this.get(id);
    const state = device.switches.find((s) => s.index === index);
    if (!state)
      throw new NotFoundException(`Nincs ${index}. kapcsoló az eszközön.`);
    const value = output === 'toggle' ? !state.output : output;
    return this.simulation.setSwitch(id, index, value, 'button');
  }

  messages(id: string): readonly MqttLogEntry[] {
    this.get(id);
    return this.simulation.messages(id) ?? [];
  }

  /** Az eszközazonosító és a ténylegesen használt topic-előtag is egyedi. */
  private assertUnique(config: ShellyConfig, selfId?: string): void {
    const prefix = shellyTopicPrefix(config);
    for (const other of this.simulation.list()) {
      if (other.id === selfId || !other.shelly) continue;
      if (other.shelly.deviceId === config.deviceId) {
        throw new ConflictException(
          `A(z) ${config.deviceId} eszközazonosító már foglalt (${other.name}).`,
        );
      }
      if (shellyTopicPrefix(other.shelly) === prefix) {
        throw new ConflictException(
          `A(z) "${prefix}" topic-előtagot már ${other.name} használja.`,
        );
      }
    }
  }

  private publish(view: DeviceView): DeviceView {
    this.bus.emit({ type: 'device.updated', data: view });
    return view;
  }
}
