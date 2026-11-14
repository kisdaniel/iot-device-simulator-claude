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

/**
 * P = terhelés, ha a kimenet be van kapcsolva, különben 0;
 * I = P / (U · cos φ), vagy a kézzel megadott érték (kikapcsolva ekkor is 0).
 */
export function readMeter(state: SwitchState): MeterReading {
  const meter = state.meter ?? defaultMeter(new Date(0));
  const power = state.output ? meter.loadPower : 0;
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
    energyTotal: meter.energyTotalWh,
  };
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
