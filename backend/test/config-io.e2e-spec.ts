import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigFile, DeviceView, ImportSummary } from '@iot-sim/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp, TestBroker, waitFor } from './helpers.js';

const bojler = {
  name: 'Bojler',
  type: 'shelly-1pm',
  shelly: {
    generation: 3,
    mac: 'a8032abe54dc',
    addon: { enabled: true, sensorCount: 1 },
  },
};
const mosogep = {
  name: 'Mosógép',
  type: 'tasmota',
  tasmota: {
    mac: '111111222222',
    topic: 'mosogep',
    relayCount: 2,
    hasEnergy: true,
    sensorCount: 0,
  },
};

describe('JSON konfiguráció: export és import (e2e)', () => {
  let app: INestApplication<App>;
  let broker: TestBroker;
  let dir: string;

  beforeEach(async () => {
    broker = await new TestBroker().start();
    dir = mkdtempSync(join(tmpdir(), 'iot-sim-config-'));
  });

  afterEach(async () => {
    await app?.close();
    await broker.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const server = () => app.getHttpServer();
  const devices = async () =>
    (await request(server()).get('/api/devices').expect(200))
      .body as DeviceView[];
  const post = (body: object, query: string) =>
    request(server()).post(`/api/config/import?${query}`).send(body);

  it('exportál jelszó nélkül, és az export oda-vissza változatlanul visszatölthető', async () => {
    app = await createApp({ MQTT_URL: broker.url, MQTT_PASSWORD: 'titok' });
    const created = (
      await request(server()).post('/api/devices').send(bojler).expect(201)
    ).body as DeviceView;
    await request(server()).post('/api/devices').send(mosogep).expect(201);
    await request(server())
      .put(`/api/devices/${created.id}/switches/0`)
      .send({ output: true })
      .expect(200);

    const res = await request(server()).get('/api/config/export').expect(200);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="iot-simulator-config-\d{4}-\d{2}-\d{2}\.json"/,
    );
    const file = res.body as ConfigFile;
    expect(file).toMatchObject({
      version: 1,
      broker: { url: broker.url, username: null },
      devices: [
        {
          name: 'Bojler',
          shelly: { deviceId: 'shelly1pmg3-a8032abe54dc' },
          switches: [{ index: 0, output: true }],
        },
        { name: 'Mosógép', tasmota: { topic: 'mosogep', relayCount: 2 } },
      ],
    });
    expect(JSON.stringify(file)).not.toContain('titok');
    expect(file.devices[0]).not.toHaveProperty('id');

    const withoutState = (
      await request(server())
        .get('/api/config/export?includeState=false')
        .expect(200)
    ).body as ConfigFile;
    expect(withoutState.devices[0]).not.toHaveProperty('switches');

    const summary = (await post(file, 'mode=replace').expect(200))
      .body as ImportSummary;
    expect(summary).toMatchObject({
      applied: true,
      created: [],
      updated: [],
      removed: [],
      broker: 'ignored',
    });
    expect(summary.unchanged.map((d) => d.identity)).toEqual([
      'shelly1pmg3-a8032abe54dc',
      'mosogep',
    ]);
  });

  it('dryRun: előnézet írás nélkül; replace: létrehoz, frissít, töröl, és az eszközök az új állapottal indulnak', async () => {
    app = await createApp({ MQTT_URL: broker.url });
    await request(server()).post('/api/devices').send(bojler).expect(201);
    const removed = (
      await request(server()).post('/api/devices').send(mosogep).expect(201)
    ).body as DeviceView;
    const file = {
      version: 1,
      devices: [
        {
          name: 'Bojler (új név)',
          type: 'shelly-1pm',
          shelly: { generation: 3, deviceId: 'shelly1pmg3-A8032ABE54DC' },
          switches: [{ index: 0, output: true, meter: { loadPower: 1500 } }],
        },
        {
          name: 'Szárító',
          type: 'tasmota',
          tasmota: { topic: 'szarito', relayCount: 1, hasEnergy: true },
        },
      ],
    };

    const preview = (await post(file, 'mode=replace&dryRun=true').expect(200))
      .body as ImportSummary;
    expect(preview).toMatchObject({
      mode: 'replace',
      applied: false,
      created: [{ name: 'Szárító', identity: 'szarito' }],
      updated: [
        { name: 'Bojler (új név)', identity: 'shelly1pmg3-a8032abe54dc' },
      ],
      removed: [{ name: 'Mosógép', identity: 'mosogep' }],
      broker: 'absent',
    });
    expect((await devices()).map((d) => d.name)).toEqual(['Bojler', 'Mosógép']);

    broker.clear();
    const summary = (await post(file, 'mode=replace').expect(200))
      .body as ImportSummary;
    expect(summary.applied).toBe(true);
    const after = await devices();
    expect(after.map((d) => d.name)).toEqual(['Bojler (új név)', 'Szárító']);
    expect(after[0]).toMatchObject({
      switches: [{ output: true, meter: { loadPower: 1500 } }],
      sensors: [],
    });
    expect(after.some((d) => d.id === removed.id)).toBe(false);

    // A Bojler az új állapottal jelentkezik, a törölt Tasmota elköszön.
    await waitFor(
      () =>
        broker.published.some(
          (m) =>
            m.topic === 'shelly1pmg3-a8032abe54dc/status/switch:0' &&
            JSON.parse(m.payload).output === true,
        ),
      'a Bojler bekapcsolt állapota',
    );
    await waitFor(
      () => broker.last('tele/mosogep/LWT') === 'Offline',
      'a Mosógép nem elérhető üzenete',
    );
    await waitFor(
      () => broker.last('tele/szarito/LWT') === 'Online',
      'a Szárító elérhető üzenete',
    );
  });

  it('hibás fájlnál 400 mezőszintű hibalistával, és semmi nem változik', async () => {
    app = await createApp({ MQTT_URL: broker.url });
    await request(server()).post('/api/devices').send(bojler).expect(201);
    const res = await post(
      {
        version: 1,
        devices: [
          { name: 'Új', type: 'tasmota', tasmota: { topic: 'uj' } },
          {
            name: 'Hibás',
            type: 'shelly-2pm',
            shelly: { generation: 7, deviceId: 'x' },
          },
        ],
      },
      'mode=replace',
    ).expect(400);
    expect(res.body).toEqual({
      message: 'A konfigurációs fájl hibás; semmi nem változott.',
      errors: [
        {
          path: 'devices[1].shelly.generation',
          device: 'Hibás',
          message: 'a generáció 2, 3 vagy 4 lehet',
        },
      ],
    });
    expect((await devices()).map((d) => d.name)).toEqual(['Bojler']);
    await post({ version: 1, devices: [] }, 'mode=everything').expect(400);
  });

  it('merge: a fájlban nem szereplő eszköz megmarad; ütközés esetén hiba', async () => {
    app = await createApp({ MQTT_URL: broker.url });
    await request(server()).post('/api/devices').send(bojler).expect(201);
    const ok = (
      await post(
        {
          version: 1,
          devices: [
            { name: 'Szárító', type: 'tasmota', tasmota: { topic: 'szarito' } },
          ],
        },
        'mode=merge',
      ).expect(200)
    ).body as ImportSummary;
    expect(ok).toMatchObject({ created: [{ name: 'Szárító' }], removed: [] });
    expect((await devices()).map((d) => d.name)).toEqual(['Bojler', 'Szárító']);

    const clash = await post(
      {
        version: 1,
        devices: [
          {
            name: 'Ütköző',
            type: 'shelly-1pm',
            shelly: {
              generation: 3,
              deviceId: 'shelly1pmg3-000000000001',
              topicPrefix: 'shelly1pmg3-a8032abe54dc',
            },
          },
        ],
      },
      'mode=merge',
    ).expect(400);
    expect(clash.body.errors[0]).toMatchObject({
      path: 'devices[0].shelly.deviceId',
      device: 'Ütköző',
    });
  });

  it('a broker címét is importálja, ha nem környezeti változóból jön; a jelszó megmarad', async () => {
    app = await createApp();
    await request(server())
      .put('/api/broker')
      .send({
        host: 'regi',
        port: 1883,
        tls: false,
        username: 'u',
        password: 'titok',
      })
      .expect(200);
    const file = {
      version: 1,
      broker: { url: 'mqtts://uj.example:8884', username: 'u' },
      devices: [],
    };
    expect(
      (await post(file, 'mode=merge&dryRun=true').expect(200)).body.broker,
    ).toBe('updated');
    expect(
      (await request(server()).get('/api/broker').expect(200)).body,
    ).toMatchObject({ host: 'regi' });

    expect((await post(file, 'mode=merge').expect(200)).body.broker).toBe(
      'updated',
    );
    expect(
      (await request(server()).get('/api/broker').expect(200)).body,
    ).toMatchObject({
      host: 'uj.example',
      port: 8884,
      tls: true,
      username: 'u',
      hasPassword: true,
    });
    expect(
      (await post(file, 'mode=merge&dryRun=true').expect(200)).body.broker,
    ).toBe('unchanged');
  });

  it('indításkor betölti a CONFIG_FILE-t; seed módban csak üres adatbázisba, és megmarad az újraindítás után', async () => {
    const path = join(dir, 'devices.json');
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        devices: [
          {
            name: 'Bojler',
            type: 'shelly-1pm',
            shelly: { generation: 4, deviceId: 'shelly1pmg4-a8032abe54dc' },
            switches: [{ index: 0, output: true }],
          },
        ],
      }),
    );
    const env = {
      MQTT_URL: broker.url,
      DATA_DIR: dir,
      CONFIG_FILE: path,
      CONFIG_IMPORT_MODE: 'seed',
    };
    app = await createApp(env);
    expect(
      (await devices()).map((d) => [d.name, d.switches[0].output]),
    ).toEqual([['Bojler', true]]);
    await request(server()).post('/api/devices').send(mosogep).expect(201);
    await app.close();

    // Második indulás: az adatbázis már nem üres, a fájl nem írja felül.
    writeFileSync(path, JSON.stringify({ version: 1, devices: [] }));
    app = await createApp(env);
    expect((await devices()).map((d) => d.name)).toEqual(['Bojler', 'Mosógép']);
    await app.close();

    // replace módban a fájl az irányadó.
    app = await createApp({ ...env, CONFIG_IMPORT_MODE: 'replace' });
    expect(await devices()).toEqual([]);
  });

  it('hibás CONFIG_FILE-nál az indulás érthető hibával leáll', async () => {
    const path = join(dir, 'bad.json');
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        devices: [{ name: 'X', type: 'tasmota', tasmota: {} }],
      }),
    );
    await expect(
      createApp({ MQTT_URL: broker.url, CONFIG_FILE: path }),
    ).rejects.toThrow(/devices\[0\]\.tasmota\.topic \(„X”\): a topic kötelező/);
    writeFileSync(path, '{ nem json');
    await expect(
      createApp({ MQTT_URL: broker.url, CONFIG_FILE: path }),
    ).rejects.toThrow(/nem olvasható/);
  });
});
