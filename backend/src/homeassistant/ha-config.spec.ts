import type { Device } from '@iot-sim/shared';
import { parse } from 'yaml';
import { defaultMeter } from '../simulation/meter.js';
import { buildHomeAssistantConfig } from './ha-config.js';

const meter = defaultMeter(new Date('2026-11-14T10:00:00Z'));

function shelly(
  overrides: Partial<NonNullable<Device['shelly']>> = {},
): Device {
  return {
    id: 's1',
    name: 'Nappali',
    type: 'shelly-2pm',
    enabled: true,
    shelly: {
      generation: 3,
      deviceId: 'shelly2pmg3-a8032abe54dc',
      topicPrefix: null,
      rpcNtf: true,
      statusNtf: true,
      enableControl: true,
      addon: { enabled: true, sensorCount: 1 },
      ...overrides,
    },
    switches: [
      { index: 0, output: false, source: 'init', meter },
      { index: 1, output: false, source: 'init', meter },
    ],
    sensors: [{ index: 0, address: '28FF64061FC795B1', tC: 21.5, error: null }],
  };
}

function tasmota(discovery = false): Device {
  return {
    id: 't1',
    name: 'Mosógép',
    type: 'tasmota',
    enabled: true,
    tasmota: {
      mac: 'A8032ABE54DC',
      topic: 'tasmota_BE54DC',
      fullTopic: '%prefix%/%topic%/',
      groupTopic: 'tasmotas',
      relayCount: 1,
      hasEnergy: true,
      sensorCount: 2,
      discovery,
      telePeriod: 300,
      publishOnChange: true,
      powerRetain: false,
    },
    switches: [{ index: 0, output: false, source: 'init', meter }],
    sensors: [
      { index: 0, address: '28FF64061FC795B1', tC: 21.5, error: null },
      { index: 1, address: '28FF64061FC795B2', tC: 30, error: null },
    ],
  };
}

type Entity = Record<string, unknown>;

function entities(devices: Device[], includeDiscovered = false) {
  const result = buildHomeAssistantConfig(devices, { includeDiscovered });
  const doc = parse(result.yaml) as {
    mqtt: { switch?: Entity[]; sensor?: Entity[] };
  };
  return {
    result,
    switches: doc.mqtt.switch ?? [],
    sensors: doc.mqtt.sensor ?? [],
  };
}

describe('buildHomeAssistantConfig', () => {
  it('Shelly: kapcsolók a command topicon, állapot a status topicról', () => {
    const { result, switches, sensors } = entities([shelly()]);
    expect(result).toMatchObject({
      deviceCount: 1,
      entityCount: 11,
      warnings: [],
    });
    expect(switches[1]).toMatchObject({
      name: 'Nappali 2',
      unique_id: 'iotsim_shelly2pmg3_a8032abe54dc_switch_1',
      command_topic: 'shelly2pmg3-a8032abe54dc/command/switch:1',
      payload_on: 'on',
      payload_off: 'off',
      state_topic: 'shelly2pmg3-a8032abe54dc/status/switch:1',
      value_template: "{{ 'ON' if value_json.output else 'OFF' }}",
      availability_topic: 'shelly2pmg3-a8032abe54dc/online',
      payload_available: 'true',
      device: {
        identifiers: ['shelly2pmg3-a8032abe54dc'],
        model: 'Shelly 2PM Gen3 (S3SW-002P16EU)',
      },
    });
    expect(sensors.map((s) => s.unique_id)).toEqual(
      expect.arrayContaining([
        'iotsim_shelly2pmg3_a8032abe54dc_power_0',
        'iotsim_shelly2pmg3_a8032abe54dc_energy_1',
        'iotsim_shelly2pmg3_a8032abe54dc_temperature_0',
      ]),
    );
    expect(
      sensors.find(
        (s) => s.unique_id === 'iotsim_shelly2pmg3_a8032abe54dc_energy_0',
      ),
    ).toMatchObject({
      unit_of_measurement: 'Wh',
      device_class: 'energy',
      state_class: 'total_increasing',
      value_template: '{{ value_json.aenergy.total }}',
    });
    expect(sensors.find((s) => s.device_class === 'temperature')).toMatchObject(
      {
        state_topic: 'shelly2pmg3-a8032abe54dc/status/temperature:100',
        value_template: '{{ value_json.tC }}',
      },
    );
  });

  it('Shelly: vezérlés nélkül RPC-n kapcsol, a topic-előtagot követi', () => {
    const { switches } = entities([
      shelly({ enableControl: false, topicPrefix: 'otthon/nappali' }),
    ]);
    expect(switches[0].command_topic).toBe('shelly2pmg3-a8032abe54dc/rpc');
    expect(JSON.parse(switches[0].payload_on as string)).toMatchObject({
      method: 'Switch.Set',
      params: { id: 0, on: true },
    });
    expect(switches[0].state_topic).toBe('otthon/nappali/status/switch:0');
    expect(switches[0].availability_topic).toBe('otthon/nappali/online');
  });

  it('Shelly: állapotüzenetek nélkül a NotifyStatus értesítésekből olvas, és figyelmeztet', () => {
    const { result, switches } = entities([shelly({ statusNtf: false })]);
    expect(switches[0].state_topic).toBe('shelly2pmg3-a8032abe54dc/events/rpc');
    expect(switches[0].value_template).toContain(
      "'output' in c else this.state",
    );
    expect(result.warnings).toHaveLength(1);
  });

  it('Shelly: értesítések nélkül optimista kapcsoló, mért értékek nélkül', () => {
    const { switches, sensors } = entities([
      shelly({ statusNtf: false, rpcNtf: false }),
    ]);
    expect(switches[0]).toMatchObject({ optimistic: true });
    expect(switches[0]).not.toHaveProperty('state_topic');
    expect(sensors).toEqual([]);
  });

  it('Tasmota: POWER topicok, ENERGY és DS18B20 a SENSOR üzenetből', () => {
    const { switches, sensors } = entities([tasmota()]);
    expect(switches).toEqual([
      expect.objectContaining({
        name: 'Mosógép',
        command_topic: 'cmnd/tasmota_BE54DC/POWER',
        state_topic: 'stat/tasmota_BE54DC/POWER',
        availability_topic: 'tele/tasmota_BE54DC/LWT',
        payload_available: 'Online',
      }),
    ]);
    expect(
      sensors.find((s) => s.unique_id === 'iotsim_a8032abe54dc_energy'),
    ).toMatchObject({
      state_topic: 'tele/tasmota_BE54DC/SENSOR',
      value_template: '{{ value_json.ENERGY.Total }}',
      unit_of_measurement: 'kWh',
    });
    expect(
      sensors.find((s) => s.unique_id === 'iotsim_a8032abe54dc_ds18b20_2'),
    ).toMatchObject({
      value_template:
        "{{ value_json['DS18B20-2'].Temperature if 'DS18B20-2' in value_json else this.state }}",
    });
  });

  it('a discoveryvel felvett Tasmota alapból kimarad', () => {
    const skipped = entities([tasmota(true)]);
    expect(skipped.result).toMatchObject({ deviceCount: 0, entityCount: 0 });
    expect(skipped.result.warnings[0]).toContain('discovery');
    expect(skipped.result.yaml).toContain('mqtt: {}');

    expect(entities([tasmota(true)], true).result.deviceCount).toBe(1);
  });

  it('YAML 1.1 szerint is szöveg marad az on/off és az ON/OFF, horgonyok nélkül', () => {
    const { yaml } = buildHomeAssistantConfig([shelly(), tasmota()], {
      includeDiscovered: false,
    });
    // A Home Assistant YAML 1.1-et olvas (PyYAML): ott az on/off logikai érték lenne.
    const doc = parse(yaml, { version: '1.1' }) as {
      mqtt: { switch: Entity[] };
    };
    expect(doc.mqtt.switch[0]).toMatchObject({
      payload_on: 'on',
      payload_off: 'off',
      state_on: 'ON',
    });
    expect(doc.mqtt.switch.at(-1)).toMatchObject({
      payload_on: 'ON',
      state_off: 'OFF',
    });
    expect(yaml).not.toMatch(/[&*]a\d/);
  });

  it('a lekapcsolt eszközről figyelmeztet', () => {
    const { result } = entities([{ ...tasmota(), enabled: false }]);
    expect(result.warnings).toEqual([
      expect.stringContaining('le van kapcsolva'),
    ]);
  });
});
