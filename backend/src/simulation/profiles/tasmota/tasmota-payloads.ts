import {
  type Device,
  type TasmotaConfig,
  tasmotaPowerKey,
  tasmotaSensorKey,
  tasmotaTopic,
} from '@iot-sim/shared';
import { meterActive, readMeter, round } from '../../meter.js';
import { reportedTemperature } from '../../sensors.js';

/** A szimulátor által jelentett firmware (a discovery `sw` mezője is ez lesz). */
export const TASMOTA_VERSION = '14.4.1';

export function tasmotaConfig(device: Device): TasmotaConfig {
  if (!device.tasmota)
    throw new Error(`A(z) ${device.id} eszköz nem Tasmota eszköz.`);
  return device.tasmota;
}

/** Helyi idő időzóna-jelölés nélkül, ahogy a Tasmota írja: 2026-11-14T10:35:00. */
export function tasmotaTime(now: Date): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

/** Üzemidő a Tasmota formájában: <nap>T<óó>:<pp>:<mm>. */
export function tasmotaUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  const days = Math.floor(s / 86_400);
  return `${days}T${pad(Math.floor((s % 86_400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function onOff(output: boolean): 'ON' | 'OFF' {
  return output ? 'ON' : 'OFF';
}

/** A relék állapota kulcsonként: { POWER: 'ON' } vagy { POWER1: 'ON', POWER2: 'OFF' }. */
export function powerStates(device: Device): Record<string, string> {
  const states: Record<string, string> = {};
  for (const state of device.switches) {
    states[tasmotaPowerKey(device.switches.length, state.index)] = onOff(
      state.output,
    );
  }
  return states;
}

/** tele/<t>/STATE, ill. a STATUS 11 válaszának tartalma. */
export function statePayload(
  device: Device,
  startedAt: Date,
  now: Date,
): Record<string, unknown> {
  const uptime = (now.getTime() - startedAt.getTime()) / 1000;
  return {
    Time: tasmotaTime(now),
    Uptime: tasmotaUptime(uptime),
    UptimeSec: Math.max(0, Math.floor(uptime)),
    Heap: 25,
    SleepMode: 'Dynamic',
    Sleep: 50,
    LoadAvg: 19,
    MqttCount: 1,
    ...powerStates(device),
    Wifi: {
      AP: 1,
      SSId: 'iot-simulator',
      BSSId: '00:00:00:00:00:00',
      Channel: 1,
      Mode: '11n',
      RSSI: 100,
      Signal: -40,
      LinkCount: 1,
      Downtime: '0T00:00:00',
    },
  };
}

/**
 * Az ENERGY blokk. Egyetlen mérő van (a 0. kapcsolón), amely bármelyik bekapcsolt
 * relénél méri a terhelést. A Period az utolsó időszakos jelentés óta fogyasztott Wh.
 */
export function energyPayload(
  device: Device,
  startedAt: Date,
  now: Date,
  periodBaseWh: number,
): Record<string, unknown> | undefined {
  const state = device.switches[0];
  if (!state?.meter) return undefined;
  const reading = readMeter(state, now, meterActive(device, state));
  const apparent = reading.voltage * reading.current;
  const reactive = Math.sqrt(Math.max(0, apparent ** 2 - reading.power ** 2));
  return {
    TotalStartTime: tasmotaTime(startedAt),
    Total: round(reading.energyTotal / 1000, 3),
    Yesterday: round(reading.energyYesterday / 1000, 3),
    Today: round(reading.energyToday / 1000, 3),
    Period: Math.max(0, Math.round(reading.energyTotal - periodBaseWh)),
    Power: Math.round(reading.power),
    ApparentPower: Math.round(apparent),
    ReactivePower: Math.round(reactive),
    Factor: apparent > 0 ? round(reading.power / apparent, 2) : 0,
    Voltage: Math.round(reading.voltage),
    Current: round(reading.current, 3),
  };
}

/** A DS18B20 Id mezője: a ROM-kód hat bájtos sorozatszáma (családkód és CRC nélkül). */
export function ds18b20Id(address: string): string {
  return address.slice(2, 14).toUpperCase();
}

/** tele/<t>/SENSOR, ill. a STATUS 8/10 válaszának tartalma. Hibás hőmérő kimarad. */
export function sensorPayload(
  device: Device,
  startedAt: Date,
  now: Date,
  periodBaseWh: number,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { Time: tasmotaTime(now) };
  for (const state of device.sensors) {
    const tC = reportedTemperature(state);
    if (tC === null) continue;
    payload[tasmotaSensorKey(device.sensors.length, state.index)] = {
      Id: ds18b20Id(state.address),
      Temperature: round(tC, 1),
    };
  }
  const energy = energyPayload(device, startedAt, now, periodBaseWh);
  if (energy) payload.ENERGY = energy;
  if (device.sensors.length > 0) payload.TempUnit = 'C';
  return payload;
}

/** Van-e mit jelenteni a SENSOR topicon. */
export function hasSensorData(device: Device): boolean {
  return (
    device.sensors.length > 0 ||
    device.switches.some((s) => s.meter !== undefined)
  );
}

/** A STATUS (0) válasza: az eszköz alapadatai. */
export function statusPayload(device: Device): Record<string, unknown> {
  const config = tasmotaConfig(device);
  const power = device.switches.reduce(
    (mask, s) => mask | (s.output ? 1 << s.index : 0),
    0,
  );
  return {
    Status: {
      Module: 0,
      DeviceName: device.name,
      FriendlyName: device.switches.map((s) =>
        s.index === 0 ? device.name : `${device.name} ${s.index + 1}`,
      ),
      Topic: config.topic,
      ButtonTopic: '0',
      Power: String(power),
      PowerOnState: 3,
      LedState: 1,
      SaveData: 1,
      SaveState: 1,
      SwitchTopic: '0',
      ButtonRetain: 0,
      SwitchRetain: 0,
      SensorRetain: 0,
      PowerRetain: config.powerRetain ? 1 : 0,
      InfoRetain: 0,
      StateRetain: 0,
    },
  };
}

export function statTopic(config: TasmotaConfig, command: string): string {
  return tasmotaTopic(config, 'stat', command);
}

export function teleTopic(config: TasmotaConfig, command: string): string {
  return tasmotaTopic(config, 'tele', command);
}
