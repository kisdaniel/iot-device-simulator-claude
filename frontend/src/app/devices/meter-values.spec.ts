import type { SwitchState } from '@iot-sim/shared';
import { formatEnergy, meterActive, meterValues } from './meter-values';

const t0 = Date.parse('2026-11-14T10:00:00Z');

function state(output: boolean): SwitchState {
  return {
    index: 0,
    output,
    source: 'button',
    meter: {
      loadPower: 3600,
      voltage: 230,
      currentOverride: null,
      powerFactor: 1,
      frequency: 50,
      energyTotalWh: 100,
      energyTodayWh: 0,
      energyYesterdayWh: 0,
      energyUpdatedAt: new Date(t0).toISOString(),
    },
  };
}

describe('meterValues', () => {
  it('bekapcsolva a számlálót a teljesítményből lépteti', () => {
    const values = meterValues(state(true), t0 + 10_000);
    expect(values.power).toBe(3600);
    expect(values.current).toBeCloseTo(15.652, 3);
    expect(values.energy).toBeCloseTo(110, 6);
  });

  it('kikapcsolva minden érték áll', () => {
    expect(meterValues(state(false), t0 + 10_000)).toEqual({ power: 0, current: 0, energy: 100 });
  });
});

describe('meterActive', () => {
  it('a Tasmota mérője bármelyik bekapcsolt relére aktív, a Shellyé csak a sajátjára', () => {
    const switches = [state(false), { ...state(false), index: 1, output: true }];
    expect(meterActive({ type: 'tasmota', switches } as never, switches[0])).toBe(true);
    expect(meterActive({ type: 'shelly-2pm', switches } as never, switches[0])).toBe(false);
  });
});

describe('formatEnergy', () => {
  it('1000 Wh fölött kWh-ban ír', () => {
    expect(formatEnergy(12.5)).toBe('12,50 Wh');
    expect(formatEnergy(15234.512)).toBe('15,235 kWh');
  });
});
