import { readFileSync } from 'node:fs';
import type { ConfigFile, Device } from '@iot-sim/shared';
import { defaultMeter } from '../simulation/meter.js';
import { exportConfig, parseConfigFile, planImport } from './config-plan.js';
import type { ConfigFileDto } from './config-file.dto.js';

const now = new Date('2026-11-14T12:00:00Z');

function shelly(id = 's1', mac = 'a8032abe54dc'): Device {
  return {
    id,
    name: 'Bojler',
    type: 'shelly-1pm',
    enabled: true,
    shelly: {
      generation: 3,
      deviceId: `shelly1pmg3-${mac}`,
      topicPrefix: null,
      rpcNtf: true,
      statusNtf: true,
      enableControl: true,
      addon: { enabled: true, sensorCount: 1 },
    },
    switches: [
      {
        index: 0,
        output: true,
        source: 'button',
        meter: { ...defaultMeter(now), loadPower: 1800 },
      },
    ],
    sensors: [{ index: 0, address: '28FF64061FC795B1', tC: 48.5, error: null }],
  };
}

function tasmota(id = 't1', topic = 'tasmota_BE54DC'): Device {
  return {
    id,
    name: 'Mosógép',
    type: 'tasmota',
    enabled: true,
    tasmota: {
      mac: 'A8032ABE54DC',
      topic,
      fullTopic: '%prefix%/%topic%/',
      groupTopic: 'tasmotas',
      relayCount: 2,
      hasEnergy: true,
      sensorCount: 0,
      discovery: false,
      telePeriod: 300,
      publishOnChange: true,
      powerRetain: false,
    },
    switches: [
      { index: 0, output: false, source: 'init', meter: defaultMeter(now) },
      { index: 1, output: false, source: 'init' },
    ],
    sensors: [],
  };
}

function parse(raw: unknown): ConfigFileDto {
  const result = parseConfigFile(raw);
  if (result.errors) throw new Error(JSON.stringify(result.errors));
  return result.file;
}

describe('parseConfigFile', () => {
  it('mezőszintű hibákat ad útvonallal és az eszköz nevével', () => {
    const result = parseConfigFile({
      version: 1,
      devices: [
        { name: 'Jó', type: 'tasmota', tasmota: { topic: 'jo' } },
        {
          name: 'Bojler',
          type: 'shelly-1pm',
          shelly: { generation: 5, deviceId: 'x', colour: 'kék' },
          switches: [{ index: -1 }],
        },
      ],
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        {
          path: 'devices[1].shelly.generation',
          device: 'Bojler',
          message: 'a generáció 2, 3 vagy 4 lehet',
        },
        {
          path: 'devices[1].shelly.colour',
          device: 'Bojler',
          message: 'ismeretlen mező',
        },
        {
          path: 'devices[1].switches[0].index',
          device: 'Bojler',
          message: 'legalább 0',
        },
      ]),
    );
  });

  it('ismeretlen verziót és hiányzó eszközlistát elutasít', () => {
    expect(
      parseConfigFile({ version: 2, devices: [] }).errors?.[0],
    ).toMatchObject({
      path: 'version',
    });
    expect(parseConfigFile({ version: 1 }).errors).toContainEqual({
      path: 'devices',
      message: 'a devices mező kötelező, és lista',
    });
    expect(parseConfigFile([]).errors?.[0].message).toBe(
      'a fájl tartalma egy JSON objektum',
    );
  });
});

describe('planImport', () => {
  it('merge: újat hoz létre alapértékekkel, a meglévőt azonosító szerint frissíti, az állapotát megtartja', () => {
    const file = parse({
      version: 1,
      devices: [
        // Ugyanaz a Bojler, csak az Add-on nélkül: frissül, a kapcsoló állapota marad.
        {
          name: 'Bojler 2',
          type: 'shelly-1pm',
          shelly: { generation: 3, deviceId: 'shelly1pmg3-A8032ABE54DC' },
        },
        { name: 'Szárító', type: 'tasmota', tasmota: { topic: 'szarito' } },
      ],
    });
    const { plan } = planImport(file, [shelly(), tasmota()], 'merge', now);
    expect(plan!.create).toHaveLength(1);
    expect(plan!.create[0]).toMatchObject({
      name: 'Szárító',
      tasmota: {
        topic: 'szarito',
        relayCount: 1,
        hasEnergy: false,
        groupTopic: 'tasmotas',
      },
      switches: [{ index: 0, output: false }],
    });
    expect(plan!.update).toHaveLength(1);
    expect(plan!.update[0]).toMatchObject({
      id: 's1',
      name: 'Bojler 2',
      shelly: { addon: { enabled: false, sensorCount: 0 } },
      switches: [{ output: true, meter: { loadPower: 1800 } }],
      sensors: [],
    });
    expect(plan!.remove).toEqual([]);
  });

  it('replace: a fájlban nem szereplő eszköz törlődik; seed: nem üres adatbázisnál kihagy', () => {
    const file = parse({ version: 1, devices: [] });
    expect(
      planImport(file, [shelly(), tasmota()], 'replace', now).plan!.remove.map(
        (d) => d.id,
      ),
    ).toEqual(['s1', 't1']);
    expect(planImport(file, [shelly()], 'seed', now).plan).toMatchObject({
      skipped: true,
      create: [],
    });
    expect(planImport(file, [], 'seed', now).plan!.skipped).toBe(false);
  });

  it('az állapotot a fájlból veszi, és ellenőrzi a sorszámokat és a mérőt', () => {
    const file = parse({
      version: 1,
      devices: [
        {
          name: 'Mosógép',
          type: 'tasmota',
          tasmota: { topic: 'tasmota_BE54DC', relayCount: 2, hasEnergy: true },
          switches: [
            { index: 1, output: true },
            { index: 0, meter: { loadPower: 500, energyTotalWh: 1234 } },
          ],
        },
      ],
    });
    const { plan } = planImport(file, [tasmota()], 'merge', now);
    expect(plan!.update[0].switches).toMatchObject([
      {
        index: 0,
        output: false,
        meter: {
          loadPower: 500,
          energyTotalWh: 1234,
          energyUpdatedAt: now.toISOString(),
        },
      },
      { index: 1, output: true },
    ]);

    const wrong = parse({
      version: 1,
      devices: [
        {
          name: 'Mosógép',
          type: 'tasmota',
          tasmota: { topic: 'm', relayCount: 2, hasEnergy: true },
          switches: [{ index: 1, meter: { loadPower: 1 } }, { index: 5 }],
          sensors: [{ index: 0, tC: 20 }],
        },
      ],
    });
    expect(planImport(wrong, [], 'merge', now).errors).toEqual([
      {
        path: 'devices[0].switches[0].meter',
        device: 'Mosógép',
        message: 'a(z) 1. kapcsolónak nincs mérője',
      },
      {
        path: 'devices[0].switches[1].index',
        device: 'Mosógép',
        message: 'nincs 5. kapcsoló; a sorszám 0 és 1 között lehet',
      },
      {
        path: 'devices[0].sensors[0].index',
        device: 'Mosógép',
        message: 'az eszköznek nincs hőmérője',
      },
    ]);
  });

  it('a deviceId-nak illenie kell a típushoz és a generációhoz', () => {
    const file = parse({
      version: 1,
      devices: [
        {
          name: 'X',
          type: 'shelly-2pm',
          shelly: { generation: 3, deviceId: 'shelly1pmg3-a8032abe54dc' },
        },
      ],
    });
    expect(planImport(file, [], 'merge', now).errors).toEqual([
      {
        path: 'devices[0].shelly.deviceId',
        device: 'X',
        message:
          'shelly-2pm 3. generációnál az eszközazonosító shelly2pmg3-<12 hexadecimális jegy> alakú',
      },
    ]);
  });

  it('ütközést jelez a fájlon belül és a megmaradó eszközökkel', () => {
    const file = parse({
      version: 1,
      devices: [
        { name: 'A', type: 'tasmota', tasmota: { topic: 'dupla' } },
        { name: 'B', type: 'tasmota', tasmota: { topic: 'dupla' } },
        // A meglévő Bojler topic-előtagját venné el.
        {
          name: 'C',
          type: 'shelly-1pm',
          shelly: {
            generation: 3,
            deviceId: 'shelly1pmg3-000000000001',
            topicPrefix: 'shelly1pmg3-a8032abe54dc',
          },
        },
      ],
    });
    const errors = planImport(file, [shelly()], 'merge', now).errors!;
    expect(errors.map((e) => [e.path, e.device])).toEqual([
      ['devices[1].tasmota.topic', 'B'],
      ['devices[2].shelly.deviceId', 'C'],
    ]);
    expect(errors[1].message).toContain('a meglévő „Bojler” eszköz');
    // replace módban a Bojler kikerül, így nincs ütközés a C-vel.
    expect(planImport(file, [shelly()], 'replace', now).errors).toHaveLength(1);
  });

  it('az export változtatás nélkül visszatölthető: állapottal együtt minden változatlan', () => {
    const devices = [shelly(), tasmota()];
    const exported = exportConfig(
      devices,
      { url: 'mqtt://mosquitto:1883', username: null },
      true,
      now,
    );
    const roundTrip = JSON.parse(JSON.stringify(exported)) as ConfigFile;
    const { plan } = planImport(parse(roundTrip), devices, 'replace', now);
    expect(plan).toMatchObject({ create: [], update: [], remove: [] });
    expect(plan!.unchanged.map((d) => d.id)).toEqual(['s1', 't1']);
    // Üres adatbázisba ugyanazokat hozza létre, ugyanazzal az állapottal
    // (a kapcsolás forrása nincs a fájlban, ott „init” lesz).
    const strip = (list: Device[]) =>
      list.map(({ id: _id, ...rest }) => ({
        ...rest,
        switches: rest.switches.map(({ source: _source, ...sw }) => sw),
      }));
    const fresh = planImport(parse(roundTrip), [], 'replace', now).plan!.create;
    expect(strip(fresh)).toEqual(strip(devices));
  });

  it('az export állapot nélkül is visszatölthető, és nem tartalmaz jelszót vagy belső azonosítót', () => {
    const exported = exportConfig(
      [shelly()],
      { url: 'mqtt://h:1883', username: 'u' },
      false,
      now,
    );
    expect(exported.devices[0]).not.toHaveProperty('id');
    expect(exported.devices[0]).not.toHaveProperty('switches');
    expect(exported.devices[0].sensors).toEqual([
      { index: 0, address: '28FF64061FC795B1' },
    ]);
    expect(JSON.stringify(exported)).not.toContain('password');
    expect(
      parseConfigFile(JSON.parse(JSON.stringify(exported))).errors,
    ).toBeUndefined();
  });
});

describe('config/devices.json minta', () => {
  it('érvényes, és üres adatbázisba betölthető', () => {
    const raw: unknown = JSON.parse(
      readFileSync(
        new URL('../../../config/devices.json', import.meta.url),
        'utf8',
      ),
    );
    const { plan, errors } = planImport(parse(raw), [], 'seed', now);
    expect(errors).toBeUndefined();
    expect(plan!.create.map((d) => d.name)).toEqual([
      'Bojler',
      'Nappali',
      'Mosógép',
    ]);
  });
});
