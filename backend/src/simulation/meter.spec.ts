import type { Device, SwitchState } from '@iot-sim/shared';
import {
  commitEnergy,
  defaultMeter,
  energyAt,
  meterActive,
  readMeter,
  round,
} from './meter.js';

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

describe('energiaszámláló', () => {
  const start = new Date('2026-11-14T10:00:00Z');
  const later = (seconds: number) => new Date(start.getTime() + seconds * 1000);

  function running(output: boolean): SwitchState {
    return {
      index: 0,
      output,
      source: 'init',
      meter: { ...defaultMeter(start), loadPower: 3600, energyTotalWh: 10 },
    };
  }

  it('bekapcsolva a teljesítménnyel arányosan nő', () => {
    expect(energyAt(running(true), later(1)).total).toBeCloseTo(11, 6);
    expect(energyAt(running(true), later(3600)).total).toBeCloseTo(3610, 6);
  });

  it('kikapcsolva áll', () => {
    expect(energyAt(running(false), later(3600)).total).toBe(10);
  });

  it('visszafelé járó időre nem csökken', () => {
    expect(energyAt(running(true), later(-60)).total).toBe(10);
  });

  it('a rögzítés után az eltelt idő újraindul', () => {
    const state = running(true);
    commitEnergy(state, later(10));
    expect(state.meter).toMatchObject({
      energyTotalWh: 20,
      energyTodayWh: 10,
      energyUpdatedAt: later(10).toISOString(),
    });
    // A rögzítés után kikapcsolva a számláló nem nő tovább.
    state.output = false;
    expect(energyAt(state, later(100)).total).toBe(20);
  });
});

describe('napi bontás (helyi idő szerint)', () => {
  function meterAt(updated: Date, today: number): SwitchState {
    return {
      index: 0,
      output: true,
      source: 'init',
      meter: {
        ...defaultMeter(updated),
        loadPower: 1000,
        energyTotalWh: 500,
        energyTodayWh: today,
        energyYesterdayWh: 7,
      },
    };
  }

  it('napon belül a mai érték nő, a tegnapi marad', () => {
    const updated = new Date(2026, 10, 14, 10, 0, 0);
    const energy = energyAt(
      meterAt(updated, 100),
      new Date(2026, 10, 14, 11, 0, 0),
    );
    expect(energy).toEqual({ total: 1500, today: 1100, yesterday: 7 });
  });

  it('éjfélkor a mai érték a tegnapiba kerül', () => {
    const updated = new Date(2026, 10, 14, 23, 0, 0);
    const energy = energyAt(
      meterAt(updated, 100),
      new Date(2026, 10, 15, 0, 30, 0),
    );
    expect(energy.total).toBeCloseTo(2000, 6);
    expect(energy.yesterday).toBeCloseTo(1100, 6);
    expect(energy.today).toBeCloseTo(500, 6);
  });

  it('több nap után a tegnap egy teljes nap fogyasztása', () => {
    const updated = new Date(2026, 10, 10, 12, 0, 0);
    const energy = energyAt(
      meterAt(updated, 100),
      new Date(2026, 10, 15, 6, 0, 0),
    );
    expect(energy.yesterday).toBeCloseTo(24_000, 6);
    expect(energy.today).toBeCloseTo(6000, 6);
  });

  it('a Tasmota mérője bármelyik bekapcsolt relére aktív', () => {
    const device = {
      type: 'tasmota',
      switches: [
        { index: 0, output: false, source: 'init' },
        { index: 1, output: true, source: 'init' },
      ],
    } as Device;
    expect(meterActive(device, device.switches[0])).toBe(true);
    expect(
      meterActive(
        { ...device, type: 'shelly-2pm' } as Device,
        device.switches[0],
      ),
    ).toBe(false);
  });
});
