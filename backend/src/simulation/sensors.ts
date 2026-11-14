import { randomBytes } from 'node:crypto';
import type { TemperatureState } from '@iot-sim/shared';

/** Új hőmérő kezdeti értéke (°C). */
export const DEFAULT_TEMPERATURE_C = 21.5;

/** Dallas/Maxim CRC-8 (a 1-Wire ROM-kód utolsó bájtja). */
function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    let value = byte;
    for (let bit = 0; bit < 8; bit++) {
      const mix = (crc ^ value) & 0x01;
      crc >>= 1;
      if (mix) crc ^= 0x8c;
      value >>= 1;
    }
  }
  return crc;
}

/**
 * Véletlen, de formailag érvényes DS18B20 ROM-kód 16 hex jegyként:
 * családkód (0x28), 6 bájt sorozatszám, CRC-8.
 */
export function randomDs18b20Address(): string {
  const rom = new Uint8Array(8);
  rom[0] = 0x28;
  rom.set(randomBytes(6), 1);
  rom[7] = crc8(rom.subarray(0, 7));
  return Buffer.from(rom).toString('hex').toUpperCase();
}

/** Igaz, ha a ROM-kód CRC-je rendben van. */
export function isValidDs18b20Address(address: string): boolean {
  if (!/^[0-9A-Fa-f]{16}$/.test(address)) return false;
  const rom = Buffer.from(address, 'hex');
  return rom[0] === 0x28 && crc8(rom.subarray(0, 7)) === rom[7];
}

/**
 * A kért számú hőmérő; a már meglévők címe és értéke megmarad,
 * az újak véletlen címet és alapértéket kapnak.
 */
export function resizeSensors(
  existing: readonly TemperatureState[],
  count: number,
): TemperatureState[] {
  return Array.from({ length: count }, (_, index) => {
    const current = existing.find((s) => s.index === index);
    return current
      ? structuredClone(current)
      : {
          index,
          address: randomDs18b20Address(),
          tC: DEFAULT_TEMPERATURE_C,
          error: null,
        };
  });
}

/** A jelentett érték: hiba esetén nincs mérés (null). */
export function reportedTemperature(state: TemperatureState): number | null {
  return state.error ? null : state.tC;
}
