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
import type { MeterPatch, SensorPatch } from '../simulation/device-profile.js';
import { resizeSensors } from '../simulation/sensors.js';
import type {
  AddonDto,
  CreateDeviceDto,
  SetMeterDto,
  SetSensorDto,
  UpdateDeviceDto,
} from './devices.dto.js';

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
      addon: normalizeAddon(dto.shelly.addon),
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
      sensors: resizeSensors([], config.addon.sensorCount),
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
      const { topicPrefix, rpcNtf, statusNtf, enableControl, addon } =
        dto.shelly;
      if (addon !== undefined) {
        const normalized = normalizeAddon(addon);
        device.sensors = resizeSensors(device.sensors, normalized.sensorCount);
        device.shelly = { ...device.shelly, addon: normalized };
      }
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
    if (JSON.stringify(device.sensors) !== JSON.stringify(current.sensors)) {
      await this.store.updateWithSensors(device);
    } else {
      await this.store.update(device);
    }
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

  setMeter(id: string, index: number, dto: SetMeterDto): DeviceView {
    this.meterSwitch(id, index);
    const patch: MeterPatch = {};
    for (const key of [
      'loadPower',
      'voltage',
      'currentOverride',
      'powerFactor',
      'frequency',
      'energyTotalWh',
    ] as const) {
      if (dto[key] !== undefined) Object.assign(patch, { [key]: dto[key] });
    }
    return this.simulation.setMeter(id, index, patch);
  }

  setSensor(id: string, index: number, dto: SetSensorDto): DeviceView {
    const device = this.get(id);
    if (!device.sensors.some((s) => s.index === index)) {
      throw new NotFoundException(`Nincs ${index}. hőmérő az eszközön.`);
    }
    const patch: SensorPatch = {};
    // 0,1 °C a DS18B20 jelentési felbontása a felületen.
    if (dto.tC !== undefined) patch.tC = Math.round(dto.tC * 10) / 10;
    if (dto.error !== undefined) patch.error = dto.error;
    return this.simulation.setSensor(id, index, patch);
  }

  resetEnergy(id: string, index: number): DeviceView {
    this.meterSwitch(id, index);
    return this.simulation.resetEnergy(id, index);
  }

  messages(id: string): readonly MqttLogEntry[] {
    this.get(id);
    return this.simulation.messages(id) ?? [];
  }

  private meterSwitch(id: string, index: number): void {
    const state = this.get(id).switches.find((s) => s.index === index);
    if (!state)
      throw new NotFoundException(`Nincs ${index}. kapcsoló az eszközön.`);
    if (!state.meter) {
      throw new BadRequestException(`A(z) ${index}. kapcsolónak nincs mérője.`);
    }
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

/** Kikapcsolt Add-onon nincs hőmérő; bekapcsolva legalább egy kell. */
function normalizeAddon(addon: AddonDto | undefined): ShellyConfig['addon'] {
  if (!addon?.enabled) return { enabled: false, sensorCount: 0 };
  if (addon.sensorCount < 1) {
    throw new BadRequestException(
      'Bekapcsolt Add-onhoz legalább egy hőmérő kell (1–5).',
    );
  }
  return { enabled: true, sensorCount: addon.sensorCount };
}
