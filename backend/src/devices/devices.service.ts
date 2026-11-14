import { randomBytes, randomUUID } from 'node:crypto';
import {
  type Device,
  type DeviceView,
  defaultTasmotaTopic,
  type MqttLogEntry,
  SHELLY_SWITCH_COUNT,
  type ShellyConfig,
  shellyDeviceId,
  shellyTopicPrefix,
  type SwitchState,
  TASMOTA_DEFAULTS,
  type TasmotaConfig,
  tasmotaTopic,
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
  UpdateShellyDto,
  UpdateTasmotaDto,
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
    const mac = randomBytes(6).toString('hex');
    const device =
      dto.type === 'tasmota'
        ? this.newTasmota(dto, mac)
        : this.newShelly(dto, mac);
    await this.store.insert(device);
    return this.publish(this.simulation.load(device));
  }

  async update(id: string, dto: UpdateDeviceDto): Promise<DeviceView> {
    const current = this.get(id);
    const { status: _status, ...device } = structuredClone(current);
    if (dto.name !== undefined) device.name = dto.name.trim();
    if (dto.shelly) this.applyShelly(device, dto.shelly);
    if (dto.tasmota) this.applyTasmota(device, dto.tasmota);

    const structure = (d: Device) =>
      JSON.stringify([
        d.switches.map((s) => [s.index, s.meter !== undefined]),
        d.sensors,
      ]);
    if (structure(device) !== structure(current)) {
      await this.store.updateWithChildren(device);
    } else {
      await this.store.update(device);
    }
    return this.publish(this.simulation.reconfigure(device));
  }

  private newShelly(dto: CreateDeviceDto, randomMac: string): Device {
    if (!dto.shelly || dto.tasmota || dto.type === 'tasmota') {
      throw new BadRequestException(
        'Shelly típushoz csak shelly beállítás adható meg.',
      );
    }
    const now = new Date();
    const mac = (dto.shelly.mac ?? randomMac).toLowerCase();
    const config: ShellyConfig = {
      generation: dto.shelly.generation,
      deviceId: shellyDeviceId(dto.type, dto.shelly.generation, mac),
      topicPrefix: dto.shelly.topicPrefix || null,
      rpcNtf: dto.shelly.rpcNtf ?? true,
      statusNtf: dto.shelly.statusNtf ?? true,
      enableControl: dto.shelly.enableControl ?? true,
      addon: normalizeAddon(dto.shelly.addon),
    };
    this.assertUniqueShelly(config);
    return {
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
  }

  private newTasmota(dto: CreateDeviceDto, randomMac: string): Device {
    const t = dto.tasmota;
    if (!t || dto.shelly) {
      throw new BadRequestException(
        'Tasmota típushoz csak tasmota beállítás adható meg.',
      );
    }
    const mac = (t.mac ?? randomMac).toUpperCase();
    const config: TasmotaConfig = {
      mac,
      topic: t.topic ?? defaultTasmotaTopic(mac),
      fullTopic: normalizeFullTopic(t.fullTopic ?? TASMOTA_DEFAULTS.fullTopic),
      groupTopic: t.groupTopic ?? TASMOTA_DEFAULTS.groupTopic,
      relayCount: t.relayCount,
      hasEnergy: t.hasEnergy,
      sensorCount: t.sensorCount,
      discovery: t.discovery ?? false,
      telePeriod: t.telePeriod ?? TASMOTA_DEFAULTS.telePeriod,
      publishOnChange: t.publishOnChange ?? TASMOTA_DEFAULTS.publishOnChange,
      powerRetain: t.powerRetain ?? TASMOTA_DEFAULTS.powerRetain,
    };
    this.assertUniqueTasmota(config);
    return {
      id: randomUUID(),
      name: dto.name.trim(),
      type: 'tasmota',
      enabled: dto.enabled ?? true,
      tasmota: config,
      switches: resizeSwitches([], t.relayCount, t.hasEnergy),
      sensors: resizeSensors([], t.sensorCount),
    };
  }

  private applyShelly(device: Device, dto: UpdateShellyDto): void {
    if (!device.shelly) {
      throw new BadRequestException('Az eszköz nem Shelly eszköz.');
    }
    const { topicPrefix, rpcNtf, statusNtf, enableControl, addon } = dto;
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
    this.assertUniqueShelly(device.shelly, device.id);
  }

  private applyTasmota(device: Device, dto: UpdateTasmotaDto): void {
    if (!device.tasmota) {
      throw new BadRequestException('Az eszköz nem Tasmota eszköz.');
    }
    const config: TasmotaConfig = { ...device.tasmota };
    for (const key of [
      'topic',
      'groupTopic',
      'relayCount',
      'hasEnergy',
      'sensorCount',
      'telePeriod',
      'publishOnChange',
      'powerRetain',
      'discovery',
    ] as const) {
      if (dto[key] !== undefined) Object.assign(config, { [key]: dto[key] });
    }
    if (dto.fullTopic !== undefined) {
      config.fullTopic = normalizeFullTopic(dto.fullTopic);
    }
    device.switches = resizeSwitches(
      device.switches,
      config.relayCount,
      config.hasEnergy,
    );
    device.sensors = resizeSensors(device.sensors, config.sensorCount);
    device.tasmota = config;
    this.assertUniqueTasmota(config, device.id);
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

  /** A Tasmota topic és a belőle képzett parancstopic is egyedi. */
  private assertUniqueTasmota(config: TasmotaConfig, selfId?: string): void {
    if (config.topic === config.groupTopic) {
      throw new BadRequestException(
        'A topic és a csoporttopic nem lehet azonos.',
      );
    }
    const command = tasmotaTopic(config, 'cmnd');
    for (const other of this.simulation.list()) {
      if (other.id === selfId || !other.tasmota) continue;
      if (
        other.tasmota.topic === config.topic ||
        tasmotaTopic(other.tasmota, 'cmnd') === command
      ) {
        throw new ConflictException(
          `A(z) "${config.topic}" topicot már ${other.name} használja.`,
        );
      }
    }
  }

  /** Az eszközazonosító és a ténylegesen használt topic-előtag is egyedi. */
  private assertUniqueShelly(config: ShellyConfig, selfId?: string): void {
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

/** A FullTopic perjelre végződik; a Tasmota is így egészíti ki. */
function normalizeFullTopic(fullTopic: string): string {
  return fullTopic.endsWith('/') ? fullTopic : `${fullTopic}/`;
}

/**
 * A Tasmota relék a kért számra méretezve; a meglévők állapota megmarad.
 * Az egyetlen mérő (ha van) a 0. kapcsolón él, és az egész eszközt méri.
 */
function resizeSwitches(
  existing: readonly SwitchState[],
  count: number,
  hasEnergy: boolean,
): SwitchState[] {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const current = existing.find((s) => s.index === index);
    const state: SwitchState = current
      ? { index, output: current.output, source: current.source }
      : { index, output: false, source: 'init' };
    if (index === 0 && hasEnergy) {
      state.meter = current?.meter
        ? structuredClone(current.meter)
        : defaultMeter(now);
    }
    return state;
  });
}
