import { type Device, shellyDeviceId } from '@iot-sim/shared';
import { defaultMeter } from '../../meter.js';
import {
  changedFields,
  deviceInfo,
  shellyMac,
  switchStatus,
} from './shelly-status.js';

function device(
  type: 'shelly-1pm' | 'shelly-2pm',
  generation: 2 | 3 | 4,
): Device {
  return {
    id: 'x',
    name: 'Bojler',
    type,
    enabled: true,
    shelly: {
      generation,
      deviceId: shellyDeviceId(type, generation, 'A8032ABE54DC'),
      topicPrefix: null,
      rpcNtf: true,
      statusNtf: true,
      enableControl: true,
      addon: { enabled: false, sensorCount: 0 },
    },
    switches: [],
    sensors: [],
  };
}

describe('Shelly állapotok', () => {
  it.each([
    ['shelly-1pm', 2, 'shellyplus1pm-a8032abe54dc', 'SNSW-001P16EU'],
    ['shelly-1pm', 3, 'shelly1pmg3-a8032abe54dc', 'S3SW-001P16EU'],
    ['shelly-2pm', 4, 'shelly2pmg4-a8032abe54dc', 'S4SW-002P16EU'],
  ] as const)('%s Gen%s azonosítója és modellje', (type, gen, id, model) => {
    const info = deviceInfo(device(type, gen));
    expect(info).toMatchObject({
      id,
      model,
      gen,
      mac: 'A8032ABE54DC',
      name: 'Bojler',
    });
    expect(shellyMac(device(type, gen).shelly!)).toBe('A8032ABE54DC');
  });

  it('a kapcsoló állapota kerekített mért értékekkel', () => {
    const now = new Date('2026-11-14T10:35:42Z');
    const status = switchStatus(
      {
        index: 1,
        output: true,
        source: 'MQTT',
        meter: { ...defaultMeter(), loadPower: 1200 },
      },
      now,
    );
    expect(status).toMatchObject({
      id: 1,
      output: true,
      source: 'MQTT',
      apower: 1200,
      voltage: 230,
      current: 5.217,
      aenergy: {
        total: 0,
        minute_ts: Date.parse('2026-11-14T10:35:00Z') / 1000,
      },
      temperature: { tC: 45, tF: 113 },
    });
  });

  it('a változáslista kihagyja a számlálót és a hőmérsékletet', () => {
    const before = {
      id: 0,
      output: false,
      apower: 0,
      aenergy: { total: 1 },
      temperature: {},
    };
    const after = {
      id: 0,
      output: true,
      apower: 10,
      aenergy: { total: 2 },
      temperature: {},
    };
    expect(changedFields(before, after)).toEqual({ output: true, apower: 10 });
  });
});
