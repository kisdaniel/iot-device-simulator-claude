import type {
  Device,
  MeterState,
  ShellyConfig,
  SwitchState,
  TasmotaConfig,
} from '@iot-sim/shared';
import type { DeviceEntity } from '../storage/entities/device.entity.js';
import type { SwitchEntity } from '../storage/entities/switch.entity.js';

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
