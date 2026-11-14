import type { SwitchState } from '@iot-sim/shared';

/** A jelentett értékek a szerver mérési modellje szerint (meter.ts). */
export interface MeterValues {
  power: number;
  current: number;
  /** Wh, a megadott pillanatig léptetve */
  energy: number;
}

export function meterValues(state: SwitchState, now: number): MeterValues {
  const meter = state.meter;
  if (!meter) return { power: 0, current: 0, energy: 0 };
  const power = state.output ? meter.loadPower : 0;
  const divisor = meter.voltage * meter.powerFactor;
  const current = state.output ? (meter.currentOverride ?? (divisor > 0 ? power / divisor : 0)) : 0;
  // A két szerveresemény között a számlálót a böngésző lépteti a teljesítményből.
  const elapsedMs = Math.max(0, now - Date.parse(meter.energyUpdatedAt));
  return { power, current, energy: meter.energyTotalWh + (power * elapsedMs) / 3_600_000 };
}

/** Energia olvasható egységgel: Wh, ill. 1000 Wh fölött kWh. */
export function formatEnergy(wh: number): string {
  const nf = (digits: number) =>
    new Intl.NumberFormat('hu-HU', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  return wh >= 1000 ? `${nf(3).format(wh / 1000)} kWh` : `${nf(2).format(wh)} Wh`;
}

export function formatNumber(value: number, digits: number): string {
  return new Intl.NumberFormat('hu-HU', { maximumFractionDigits: digits }).format(value);
}
