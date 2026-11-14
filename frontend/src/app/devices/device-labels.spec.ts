import type { Device } from '@iot-sim/shared';
import {
  deviceTopics,
  sensorKey,
  shellyTopics,
  switchKey,
  switchLabel,
  typeLabel,
} from './device-labels';

const base: Device = {
  id: 'd1',
  name: 'Nappali',
  type: 'shelly-2pm',
  enabled: true,
  shelly: {
    generation: 2,
    deviceId: 'shellyplus2pm-a8032abe54dc',
    topicPrefix: 'otthon/nappali',
    rpcNtf: true,
    statusNtf: false,
    enableControl: true,
    addon: { enabled: false, sensorCount: 0 },
  },
  switches: [
    { index: 0, output: false, source: 'init' },
    { index: 1, output: false, source: 'init' },
  ],
  sensors: [],
};

describe('device-labels', () => {
  it('a típusnév a generációt is tartalmazza', () => {
    expect(typeLabel(base)).toBe('Shelly Plus 2PM');
  });

  it('a topiclista követi az előtagot és a kapcsolókat', () => {
    const topics = shellyTopics(base).map((t) => t.topic);
    expect(topics).toContain('otthon/nappali/online');
    expect(topics).toContain('shellyplus2pm-a8032abe54dc/rpc');
    expect(topics).toContain('otthon/nappali/rpc');
    expect(topics).toContain('otthon/nappali/command/switch:1');
    // Kikapcsolt állapotüzenetek: nincs status topic.
    expect(topics.some((t) => t.includes('/status/'))).toBe(false);
  });

  it('az Add-on hőmérőinek állapottopicja temperature:100-tól számoz', () => {
    const device: Device = {
      ...base,
      shelly: { ...base.shelly!, statusNtf: true },
      sensors: [
        { index: 0, address: '28FF64061FC795B1', tC: 21.5, error: null },
        { index: 1, address: '28FF64061FC795B2', tC: 30, error: null },
      ],
    };
    const topics = shellyTopics(device).map((t) => t.topic);
    expect(topics).toContain('otthon/nappali/status/temperature:100');
    expect(topics).toContain('otthon/nappali/status/temperature:101');
  });

  it('a Tasmota topicjai a FullTopic és a relék szerint készülnek', () => {
    const device: Device = {
      id: 't1',
      name: 'Mosógép',
      type: 'tasmota',
      enabled: true,
      tasmota: {
        mac: 'A8032ABE54DC',
        topic: 'mosogep',
        fullTopic: '%prefix%/%topic%/',
        groupTopic: 'tasmotas',
        relayCount: 2,
        hasEnergy: true,
        sensorCount: 1,
        discovery: false,
        telePeriod: 300,
        publishOnChange: true,
        powerRetain: false,
      },
      switches: [
        { index: 0, output: false, source: 'init' },
        { index: 1, output: false, source: 'init' },
      ],
      sensors: [{ index: 0, address: '28FF64061FC795B1', tC: 21.5, error: null }],
    };
    const topics = deviceTopics(device).map((t) => t.topic);
    expect(topics).toEqual(
      expect.arrayContaining([
        'tele/mosogep/LWT',
        'cmnd/mosogep/POWER1',
        'cmnd/mosogep/POWER2',
        'stat/mosogep/RESULT',
        'cmnd/tasmotas/#',
        'tele/mosogep/SENSOR',
      ]),
    );
    expect(typeLabel(device)).toBe('Tasmota');
    expect(switchLabel(device, 1)).toBe('Relé 2');
    expect(switchKey(device, 1)).toBe('POWER2');
    expect(sensorKey(device, 0)).toBe('DS18B20');
  });
});
