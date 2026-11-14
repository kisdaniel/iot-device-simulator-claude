import type { MeterState, SwitchState } from '@iot-sim/shared';

/** Új kapcsoló mérője: nincs terhelés, 230 V, 50 Hz, nullázott számláló. */
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
  /** W; kikapcsolt kimenetnél 0 */
  power: number;
  /** A */
  current: number;
  voltage: number;
  powerFactor: number;
  frequency: number;
  /** Wh */
  energyTotal: number;
}

/** A pillanatnyi teljesítmény: a terhelés, ha a kimenet be van kapcsolva, különben 0. */
export function powerOf(state: SwitchState): number {
  return state.output && state.meter ? state.meter.loadPower : 0;
}

/**
 * A számláló értéke egy adott pillanatban (Wh): a legutóbb rögzített érték, plusz
 * az azóta eltelt idő a pillanatnyi teljesítménnyel. Az eltelt idő nem lehet negatív.
 */
export function energyAt(state: SwitchState, now: Date): number {
  const meter = state.meter;
  if (!meter) return 0;
  const elapsedMs = Math.max(
    0,
    now.getTime() - Date.parse(meter.energyUpdatedAt),
  );
  return meter.energyTotalWh + (powerOf(state) * elapsedMs) / 3_600_000;
}

/**
 * Rögzíti a számlálót a megadott pillanatig. Minden olyan változás előtt hívandó,
 * amely a teljesítményt módosíthatja (kapcsolás, terhelés), és mentés előtt.
 */
export function commitEnergy(state: SwitchState, now: Date): void {
  const meter = state.meter;
  if (!meter) return;
  const updatedAt = Date.parse(meter.energyUpdatedAt);
  const delta = energyAt(state, now) - meter.energyTotalWh;
  meter.energyTotalWh += delta;
  meter.energyTodayWh += delta;
  if (now.getTime() > updatedAt) meter.energyUpdatedAt = now.toISOString();
}

/**
 * P = terhelés, ha a kimenet be van kapcsolva, különben 0;
 * I = P / (U · cos φ), vagy a kézzel megadott érték (kikapcsolva ekkor is 0).
 */
export function readMeter(
  state: SwitchState,
  now: Date = new Date(),
): MeterReading {
  const meter = state.meter ?? defaultMeter(new Date(0));
  const power = powerOf(state);
  let current = 0;
  if (state.output) {
    const divisor = meter.voltage * meter.powerFactor;
    current = meter.currentOverride ?? (divisor > 0 ? power / divisor : 0);
  }
  return {
    power,
    current,
    voltage: meter.voltage,
    powerFactor: meter.powerFactor,
    frequency: meter.frequency,
    energyTotal: energyAt(state, now),
  };
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
