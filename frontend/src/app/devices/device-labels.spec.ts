import type { Device } from '@iot-sim/shared';
import { shellyTopics, typeLabel } from './device-labels';

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
});
