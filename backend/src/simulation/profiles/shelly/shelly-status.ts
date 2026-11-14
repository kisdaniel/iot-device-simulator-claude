import {
  type Device,
  SHELLY_MODELS,
  type ShellyConfig,
  type ShellyDeviceType,
  type SwitchState,
} from '@iot-sim/shared';
import { readMeter, round } from '../../meter.js';

/** A szimulált eszköz belső hőmérséklete: rögzített, nem állítható. */
const DEVICE_TEMPERATURE_C = 45;

/** A szimulátor által jelentett firmware. */
export const SIMULATED_FIRMWARE = {
  ver: '1.6.0',
  fwId: '20260101-000000/1.6.0-iotsim',
};

export function shellyConfig(device: Device): ShellyConfig {
  if (!device.shelly)
    throw new Error(`A(z) ${device.id} eszköz nem Shelly eszköz.`);
  return device.shelly;
}

/** A MAC-cím nagybetűvel, az eszközazonosító végéről. */
export function shellyMac(config: ShellyConfig): string {
  return (config.deviceId.split('-').at(-1) ?? '').toUpperCase();
}

/** Unix-idő a Shelly módján: másodperc, két tizedesre. */
export function shellyTimestamp(now: Date): number {
  return round(now.getTime() / 1000, 2);
}

/** A `switch:<id>` komponens teljes állapota (Switch.GetStatus, status/switch:<id>). */
export function switchStatus(
  state: SwitchState,
  now: Date,
): Record<string, unknown> {
  const reading = readMeter(state);
  return {
    id: state.index,
    source: state.source,
    output: state.output,
    apower: round(reading.power, 1),
    voltage: round(reading.voltage, 1),
    freq: round(reading.frequency, 1),
    current: round(reading.current, 3),
    pf: round(reading.powerFactor, 2),
    aenergy: {
      total: round(reading.energyTotal, 3),
      // A percenkénti bontás a mérési modellel együtt érkezik.
      by_minute: [0, 0, 0],
      minute_ts: Math.floor(now.getTime() / 60_000) * 60,
    },
    temperature: {
      tC: DEVICE_TEMPERATURE_C,
      tF: round((DEVICE_TEMPERATURE_C * 9) / 5 + 32, 1),
    },
  };
}

/** Minimális kapcsolókonfiguráció (Switch.GetConfig). */
export function switchConfig(state: SwitchState): Record<string, unknown> {
  return {
    id: state.index,
    name: null,
    in_mode: 'follow',
    initial_state: 'match_params',
    auto_on: false,
    auto_on_delay: 60,
    auto_off: false,
    auto_off_delay: 60,
  };
}

/** Shelly.GetDeviceInfo. */
export function deviceInfo(device: Device): Record<string, unknown> {
  const config = shellyConfig(device);
  const model =
    SHELLY_MODELS[device.type as ShellyDeviceType][config.generation];
  return {
    name: device.name,
    id: config.deviceId,
    mac: shellyMac(config),
    slot: 0,
    model: model.model,
    gen: config.generation,
    fw_id: SIMULATED_FIRMWARE.fwId,
    ver: SIMULATED_FIRMWARE.ver,
    app: model.app,
    auth_en: false,
    auth_domain: null,
  };
}

/** Shelly.GetStatus: a rendszer- és MQTT-állapot, valamint minden komponens. */
export function fullStatus(
  device: Device,
  startedAt: Date,
  now: Date,
): Record<string, unknown> {
  const config = shellyConfig(device);
  const status: Record<string, unknown> = {
    sys: {
      mac: shellyMac(config),
      restart_required: false,
      time: now.toTimeString().slice(0, 5),
      unixtime: Math.floor(now.getTime() / 1000),
      uptime: Math.max(
        0,
        Math.floor((now.getTime() - startedAt.getTime()) / 1000),
      ),
      available_updates: {},
    },
    mqtt: { connected: true },
  };
  for (const state of device.switches)
    status[`switch:${state.index}`] = switchStatus(state, now);
  return status;
}

/**
 * A NotifyStatus-ba kerülő, megváltozott mezők. A számláló és a belső
 * hőmérséklet nem változásra, hanem percenként jelentődik, ezért kimarad.
 */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    if (key === 'id' || key === 'aenergy' || key === 'temperature') continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(value))
      changed[key] = value;
  }
  return changed;
}
