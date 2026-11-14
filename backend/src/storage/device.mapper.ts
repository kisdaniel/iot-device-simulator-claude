import type {
  Device,
  MeterState,
  ShellyConfig,
  SwitchState,
  TasmotaConfig,
  TemperatureState,
} from '@iot-sim/shared';
import { DeviceEntity } from './entities/device.entity.js';
import { SwitchEntity } from './entities/switch.entity.js';
import { TemperatureSensorEntity } from './entities/temperature-sensor.entity.js';

function toMeter(row: SwitchEntity): MeterState | undefined {
  if (row.loadPower === null) return undefined;
  return {
    loadPower: row.loadPower,
    voltage: row.voltage ?? 230,
    currentOverride: row.currentOverride,
    powerFactor: row.powerFactor ?? 1,
    frequency: row.frequency ?? 50,
    energyTotalWh: row.energyTotalWh ?? 0,
    energyTodayWh: row.energyTodayWh ?? 0,
    energyYesterdayWh: row.energyYesterdayWh ?? 0,
    energyUpdatedAt: row.energyUpdatedAt ?? new Date(0).toISOString(),
  };
}

function toSwitch(row: SwitchEntity): SwitchState {
  const meter = toMeter(row);
  return {
    index: row.idx,
    output: row.output,
    source: row.source,
    ...(meter ? { meter } : {}),
  };
}

/** A Shelly deviceId, ill. a Tasmota topic: az eszközök között egyedi azonosító. */
export function deviceIdentity(device: Device): string {
  return device.shelly?.deviceId ?? device.tasmota?.topic ?? device.id;
}

/** Adatbázissorokból a közös `Device` típus. */
export function toDevice(entity: DeviceEntity): Device {
  const config = JSON.parse(entity.config) as ShellyConfig | TasmotaConfig;
  return {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    enabled: entity.enabled,
    ...(entity.type === 'tasmota'
      ? { tasmota: config as TasmotaConfig }
      : { shelly: config as ShellyConfig }),
    switches: [...(entity.switches ?? [])]
      .sort((a, b) => a.idx - b.idx)
      .map(toSwitch),
    sensors: [...(entity.sensors ?? [])]
      .sort((a, b) => a.idx - b.idx)
      .map((s) => ({
        index: s.idx,
        address: s.address,
        tC: s.tc,
        error: s.error,
      })),
  };
}

export function toSwitchEntity(
  deviceId: string,
  state: SwitchState,
): SwitchEntity {
  const row = new SwitchEntity();
  const meter = state.meter;
  Object.assign(row, {
    deviceId,
    idx: state.index,
    output: state.output,
    source: state.source,
    loadPower: meter?.loadPower ?? null,
    voltage: meter?.voltage ?? null,
    currentOverride: meter?.currentOverride ?? null,
    powerFactor: meter?.powerFactor ?? null,
    frequency: meter?.frequency ?? null,
    energyTotalWh: meter?.energyTotalWh ?? null,
    energyTodayWh: meter?.energyTodayWh ?? null,
    energyYesterdayWh: meter?.energyYesterdayWh ?? null,
    energyUpdatedAt: meter?.energyUpdatedAt ?? null,
  });
  return row;
}

export function toSensorEntity(
  deviceId: string,
  state: TemperatureState,
): TemperatureSensorEntity {
  const row = new TemperatureSensorEntity();
  Object.assign(row, {
    deviceId,
    idx: state.index,
    address: state.address,
    tc: state.tC,
    error: state.error,
  });
  return row;
}

/** A `devices` sor oszlopai egy `Device`-ból (kapcsolók és szenzorok nélkül). */
export function deviceColumns(
  device: Device,
): Pick<DeviceEntity, 'name' | 'type' | 'enabled' | 'config' | 'identity'> {
  return {
    name: device.name,
    type: device.type,
    enabled: device.enabled,
    config: JSON.stringify(
      device.type === 'tasmota' ? device.tasmota : device.shelly,
    ),
    identity: deviceIdentity(device),
  };
}
