import type { Device, SwitchState } from '@iot-sim/shared';

/** A jelentett értékek a szerver mérési modellje szerint (meter.ts). */
export interface MeterValues {
  power: number;
  current: number;
  /** Wh, a megadott pillanatig léptetve */
  energy: number;
}

/**
 * Fogyaszt-e a mérő: a Shelly a saját kimenetét méri, a Tasmota egyetlen mérője
 * az egész eszközt, így bármelyik bekapcsolt relé számít.
 */
export function meterActive(device: Device, state: SwitchState): boolean {
  return device.type === 'tasmota' ? device.switches.some((s) => s.output) : state.output;
}

export function meterValues(
  state: SwitchState,
  now: number,
  active: boolean = state.output,
): MeterValues {
  const meter = state.meter;
  if (!meter) return { power: 0, current: 0, energy: 0 };
  const power = active ? meter.loadPower : 0;
  const divisor = meter.voltage * meter.powerFactor;
  const current = active ? (meter.currentOverride ?? (divisor > 0 ? power / divisor : 0)) : 0;
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
