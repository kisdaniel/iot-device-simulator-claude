import type { Device, MeterState, SwitchState } from '@iot-sim/shared';

/** Új mérő: nincs terhelés, 230 V, 50 Hz, nullázott számláló. */
export function defaultMeter(now: Date = new Date()): MeterState {
  return {
    loadPower: 0,
    voltage: 230,
    currentOverride: null,
    powerFactor: 1,
    frequency: 50,
    energyTotalWh: 0,
    energyTodayWh: 0,
    energyYesterdayWh: 0,
    energyUpdatedAt: now.toISOString(),
  };
}

/** A pillanatnyi, jelentendő mért értékek (kerekítés nélkül). */
export interface MeterReading {
  /** W; nem aktív mérőnél 0 */
  power: number;
  /** A */
  current: number;
  voltage: number;
  powerFactor: number;
  frequency: number;
  /** Wh */
  energyTotal: number;
  /** Wh, a helyi idő szerinti mai nap */
  energyToday: number;
  /** Wh, a helyi idő szerinti tegnapi nap */
  energyYesterday: number;
}

/**
 * Fogyaszt-e a mérő. A Shelly mérője a saját kimenetét méri; a Tasmota egyetlen
 * mérője (a 0. kapcsolón) az egész eszközt, így bármelyik bekapcsolt relé számít.
 */
export function meterActive(device: Device, state: SwitchState): boolean {
  if (device.type === 'tasmota') return device.switches.some((s) => s.output);
  return state.output;
}

/** A pillanatnyi teljesítmény: a terhelés, ha a mérő aktív, különben 0. */
export function powerOf(state: SwitchState, active = state.output): number {
  return active && state.meter ? state.meter.loadPower : 0;
}

function startOfLocalDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export interface EnergyBreakdown {
  total: number;
  today: number;
  yesterday: number;
}

/**
 * A számlálók értéke egy adott pillanatban (Wh): a legutóbb rögzített érték, plus
 * az azóta eltelt idő a pillanatnyi teljesítménnyel. Helyi éjfélkor a mai érték
 * a tegnapiba kerül; az eltelt idő nem lehet negatív.
 */
export function energyAt(
  state: SwitchState,
  now: Date,
  active = state.output,
): EnergyBreakdown {
  const meter = state.meter;
  if (!meter) return { total: 0, today: 0, yesterday: 0 };
  const updatedAt = Date.parse(meter.energyUpdatedAt);
  const end = Math.max(updatedAt, now.getTime());
  const watts = powerOf(state, active);
  const wh = (from: number, to: number) =>
    (watts * Math.max(0, to - from)) / 3_600_000;

  const total = meter.energyTotalWh + wh(updatedAt, end);
  const midnight = startOfLocalDay(end);
  if (updatedAt >= midnight) {
    return {
      total,
      today: meter.energyTodayWh + wh(updatedAt, end),
      yesterday: meter.energyYesterdayWh,
    };
  }
  const previousMidnight = startOfLocalDay(midnight - 1);
  const yesterday =
    updatedAt >= previousMidnight
      ? meter.energyTodayWh + wh(updatedAt, midnight)
      : wh(previousMidnight, midnight);
  return { total, today: wh(midnight, end), yesterday };
}

/**
 * Rögzíti a számlálót a megadott pillanatig. Minden olyan változás előtt hívandó,
 * amely a teljesítményt módosíthatja (kapcsolás, terhelés), és mentés előtt.
 */
export function commitEnergy(
  state: SwitchState,
  now: Date,
  active = state.output,
): void {
  const meter = state.meter;
  if (!meter) return;
  const energy = energyAt(state, now, active);
  meter.energyTotalWh = energy.total;
  meter.energyTodayWh = energy.today;
  meter.energyYesterdayWh = energy.yesterday;
  if (now.getTime() > Date.parse(meter.energyUpdatedAt)) {
    meter.energyUpdatedAt = now.toISOString();
  }
}

/** Az eszköz összes mérőjének rögzítése, a típusnak megfelelő aktivitással. */
export function commitDeviceEnergy(device: Device, now: Date): void {
  for (const state of device.switches) {
    commitEnergy(state, now, meterActive(device, state));
  }
}

/**
 * P = terhelés, ha a mérő aktív, különben 0;
 * I = P / (U · cos φ), vagy a kézzel megadott érték (inaktívan ekkor is 0).
 */
export function readMeter(
  state: SwitchState,
  now: Date = new Date(),
  active = state.output,
): MeterReading {
  const meter = state.meter ?? defaultMeter(new Date(0));
  const power = powerOf(state, active);
  let current = 0;
  if (active) {
    const divisor = meter.voltage * meter.powerFactor;
    current = meter.currentOverride ?? (divisor > 0 ? power / divisor : 0);
  }
  const energy = energyAt(state, now, active);
  return {
    power,
    current,
    voltage: meter.voltage,
    powerFactor: meter.powerFactor,
    frequency: meter.frequency,
    energyTotal: energy.total,
    energyToday: energy.today,
    energyYesterday: energy.yesterday,
  };
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
