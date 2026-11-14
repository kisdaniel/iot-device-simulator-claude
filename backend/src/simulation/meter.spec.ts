import type { SwitchState } from '@iot-sim/shared';
import { defaultMeter, readMeter, round } from './meter.js';

function sw(output: boolean, meter = {}): SwitchState {
  return {
    index: 0,
    output,
    source: 'init',
    meter: { ...defaultMeter(), ...meter },
  };
}

describe('readMeter', () => {
  it('kikapcsolt kimenetnél nulla teljesítményt és áramot ad', () => {
    expect(readMeter(sw(false, { loadPower: 1200 }))).toMatchObject({
      power: 0,
      current: 0,
    });
  });

  it('bekapcsolva a terhelésből és a feszültségből számol áramot', () => {
    const reading = readMeter(sw(true, { loadPower: 1200, voltage: 230 }));
    expect(reading.power).toBe(1200);
    expect(round(reading.current, 3)).toBe(5.217);
  });

  it('figyelembe veszi a teljesítménytényezőt', () => {
    const reading = readMeter(
      sw(true, { loadPower: 460, voltage: 230, powerFactor: 0.5 }),
    );
    expect(reading.current).toBe(4);
  });

  it('a kézzel megadott áram csak bekapcsolva érvényes', () => {
    expect(
      readMeter(sw(true, { loadPower: 100, currentOverride: 2 })).current,
    ).toBe(2);
    expect(
      readMeter(sw(false, { loadPower: 100, currentOverride: 2 })).current,
    ).toBe(0);
  });

  it('nulla feszültségnél nem oszt nullával', () => {
    expect(readMeter(sw(true, { loadPower: 100, voltage: 0 })).current).toBe(0);
  });
});
