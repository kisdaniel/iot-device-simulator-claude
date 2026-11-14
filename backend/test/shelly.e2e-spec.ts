import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceView } from '@iot-sim/shared';
import type { INestApplication } from '@nestjs/common';
import { connectAsync, type MqttClient } from 'mqtt';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { MqttGateway } from '../src/mqtt/mqtt-gateway.service.js';
import { SimulationService } from '../src/simulation/simulation.service.js';
import { createApp, TestBroker, waitFor } from './helpers.js';

const MAC = 'a8032abe54dc';

describe('Shelly kapcsoló (e2e)', () => {
  let broker: TestBroker;
  let app: INestApplication<App>;
  let control: MqttClient;
  /** A vezérlő kliens által kapott üzenetek topic szerint. */
  let inbox: Array<{ topic: string; payload: string }>;

  async function startApp(env: Record<string, string> = {}): Promise<void> {
    app = await createApp({ MQTT_URL: broker.url, ...env });
    const gateway = app.get(MqttGateway);
    await waitFor(() => gateway.isConnected, 'a közös kapcsolat felépül');
  }

  async function createDevice(body: object): Promise<DeviceView> {
    const res = await request(app.getHttpServer())
      .post('/api/devices')
      .send(body)
      .expect(201);
    return res.body as DeviceView;
  }

  function received(topic: string): unknown[] {
    return inbox
      .filter((m) => m.topic === topic)
      .map((m) => JSON.parse(m.payload));
  }

  /** RPC kérés a vezérlő kliensről; a válasz a `teszt/rpc` topicon érkezik. */
  async function rpc(
    target: string,
    method: string,
    params?: object,
  ): Promise<unknown> {
    const id = Math.floor(Math.random() * 1e9);
    await control.publishAsync(
      `${target}/rpc`,
      JSON.stringify({
        id,
        src: 'teszt',
        method,
        ...(params ? { params } : {}),
      }),
    );
    let response: { id: number } | undefined;
    await waitFor(() => {
      response = received('teszt/rpc').find(
        (r) => (r as { id: number }).id === id,
      ) as { id: number } | undefined;
      return response !== undefined;
    }, `válasz a(z) ${method} hívásra`);
    return response;
  }

  beforeEach(async () => {
    broker = await new TestBroker().start();
    control = await connectAsync(broker.url);
    inbox = [];
    control.on('message', (topic, payload) =>
      inbox.push({ topic, payload: payload.toString() }),
    );
    await control.subscribeAsync(['teszt/rpc', '#']);
  });

  afterEach(async () => {
    await control.endAsync(true);
    await app?.close();
    await broker.stop();
  });

  it('felvételkor bejelentkezik és közzéteszi a kapcsolók állapotát', async () => {
    await startApp();
    const device = await createDevice({
      name: 'Bojler',
      type: 'shelly-1pm',
      shelly: { generation: 3, mac: MAC.toUpperCase() },
    });
    expect(device).toMatchObject({
      name: 'Bojler',
      type: 'shelly-1pm',
      enabled: true,
      status: 'online',
      shelly: {
        generation: 3,
        deviceId: `shelly1pmg3-${MAC}`,
        topicPrefix: null,
      },
      switches: [{ index: 0, output: false, source: 'init' }],
    });

    const id = `shelly1pmg3-${MAC}`;
    await waitFor(
      () => broker.last(`${id}/online`) === 'true',
      'online üzenet',
    );
    expect(
      broker.published.find((m) => m.topic === `${id}/online`)?.retain,
    ).toBe(true);
    await waitFor(
      () => broker.last(`${id}/status/switch:0`) !== undefined,
      'kapcsolóállapot',
    );
    expect(JSON.parse(broker.last(`${id}/status/switch:0`)!)).toMatchObject({
      id: 0,
      output: false,
      apower: 0,
      voltage: 230,
    });
  });

  it('RPC-n kapcsol, válaszol és értesít', async () => {
    await startApp();
    const device = await createDevice({
      name: 'Nappali',
      type: 'shelly-2pm',
      shelly: { generation: 2, mac: MAC },
    });
    const id = device.shelly!.deviceId;
    expect(id).toBe(`shellyplus2pm-${MAC}`);

    expect(await rpc(id, 'Switch.Set', { id: 1, on: true })).toEqual({
      id: expect.any(Number),
      src: id,
      dst: 'teszt',
      result: { was_on: false },
    });
    await waitFor(
      () => received(`${id}/events/rpc`).length > 0,
      'NotifyStatus',
    );
    expect(received(`${id}/events/rpc`)[0]).toMatchObject({
      src: id,
      dst: `${id}/events`,
      method: 'NotifyStatus',
      params: {
        ts: expect.any(Number),
        'switch:1': { id: 1, output: true, source: 'MQTT' },
      },
    });
    await waitFor(
      () =>
        received(`${id}/status/switch:1`).some(
          (s) => (s as { output: boolean }).output,
        ),
      'status/switch:1 a bekapcsolt állapottal',
    );

    // Toggle és lekérdezés
    expect(await rpc(id, 'Switch.Toggle', { id: 1 })).toMatchObject({
      result: { was_on: true },
    });
    expect(await rpc(id, 'Switch.GetStatus', { id: 1 })).toMatchObject({
      result: { id: 1, output: false, source: 'MQTT' },
    });

    // Az állapot a REST API-n is látszik, a másik kapcsoló érintetlen.
    const view = await request(app.getHttpServer())
      .get(`/api/devices/${device.id}`)
      .expect(200);
    expect(
      view.body.switches.map((s: { output: boolean }) => s.output),
    ).toEqual([false, false]);
  });

  it('a Shelly.* metódusok a generációnak megfelelő adatot adnak', async () => {
    await startApp();
    const device = await createDevice({
      name: 'Gen4',
      type: 'shelly-2pm',
      shelly: { generation: 4, mac: MAC },
    });
    const id = device.shelly!.deviceId;

    expect(await rpc(id, 'Shelly.GetDeviceInfo')).toMatchObject({
      result: {
        id: `shelly2pmg4-${MAC}`,
        mac: MAC.toUpperCase(),
        model: 'S4SW-002P16EU',
        gen: 4,
        name: 'Gen4',
      },
    });
    const status = (await rpc(id, 'Shelly.GetStatus')) as {
      result: Record<string, unknown>;
    };
    expect(Object.keys(status.result)).toEqual(
      expect.arrayContaining(['sys', 'switch:0', 'switch:1']),
    );
  });

  it('hibás RPC-re a Shelly hibakódjaival válaszol', async () => {
    await startApp();
    const { shelly } = await createDevice({
      name: 'Hibák',
      type: 'shelly-1pm',
      shelly: { generation: 3, mac: MAC },
    });
    const id = shelly!.deviceId;

    expect(await rpc(id, 'Switch.Set', { id: 0 })).toMatchObject({
      error: { code: -103 },
    });
    expect(await rpc(id, 'Switch.Set', { id: 5, on: true })).toMatchObject({
      error: { code: -105 },
    });
    expect(await rpc(id, 'Cover.Open', { id: 0 })).toMatchObject({
      error: { code: 404, message: 'No handler for Cover.Open' },
    });
  });

  it('szöveges parancsokat fogad a command topicokon', async () => {
    await startApp();
    const { shelly } = await createDevice({
      name: 'Parancs',
      type: 'shelly-1pm',
      shelly: { generation: 2, mac: MAC, topicPrefix: 'otthon/bojler' },
    });
    const id = shelly!.deviceId;
    const prefix = 'otthon/bojler';
    await waitFor(
      () => broker.last(`${prefix}/online`) === 'true',
      'online az előtagon',
    );

    await control.publishAsync(`${prefix}/command/switch:0`, 'on');
    await waitFor(
      () =>
        received(`${prefix}/status/switch:0`).some(
          (s) => (s as { output: boolean }).output,
        ),
      'bekapcsolás a command topicról',
    );

    await control.publishAsync(`${prefix}/command/switch:0`, 'villog');
    await waitFor(
      () => inbox.some((m) => m.topic === `${prefix}/error/switch:0`),
      'hibaüzenet',
    );

    await control.publishAsync('shellies/command', 'announce');
    await waitFor(() => received('shellies/announce').length > 0, 'announce');
    expect(received(`${prefix}/announce`)[0]).toMatchObject({ id, gen: 2 });

    await control.publishAsync(`${prefix}/command`, 'status_update');
    await waitFor(
      () => received(`${prefix}/status`).length > 0,
      'teljes állapot',
    );

    // Az RPC az eszközazonosítón is él, ha az előtag eltér tőle.
    expect(await rpc(id, 'Switch.GetStatus', { id: 0 })).toMatchObject({
      result: { output: true },
    });
  });

  it('kikapcsolt vezérlésnél a command topicok nem élnek', async () => {
    await startApp();
    const { shelly } = await createDevice({
      name: 'Csak RPC',
      type: 'shelly-1pm',
      shelly: {
        generation: 3,
        mac: MAC,
        enableControl: false,
        statusNtf: false,
      },
    });
    const id = shelly!.deviceId;
    await control.publishAsync(`${id}/command/switch:0`, 'on');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await rpc(id, 'Switch.GetStatus', { id: 0 })).toMatchObject({
      result: { output: false },
    });
    expect(received(`${id}/status/switch:0`)).toEqual([]);
  });

  it('a felületi kapcsolás "button" forrással értesít', async () => {
    await startApp();
    const device = await createDevice({
      name: 'Gomb',
      type: 'shelly-1pm',
      shelly: { generation: 3, mac: MAC },
    });
    const id = device.shelly!.deviceId;
    const server = app.getHttpServer();

    const res = await request(server)
      .put(`/api/devices/${device.id}/switches/0`)
      .send({ output: true })
      .expect(200);
    expect(res.body.switches[0]).toMatchObject({
      output: true,
      source: 'button',
    });
    await waitFor(
      () => received(`${id}/events/rpc`).length > 0,
      'NotifyStatus',
    );
    expect(received(`${id}/events/rpc`)[0]).toMatchObject({
      params: { 'switch:0': { output: true, source: 'button' } },
    });

    const toggled = await request(server)
      .post(`/api/devices/${device.id}/switches/0/toggle`)
      .expect(200);
    expect(toggled.body.switches[0].output).toBe(false);

    await request(server)
      .put(`/api/devices/${device.id}/switches/3`)
      .send({ output: true })
      .expect(404);
    await request(server)
      .put(`/api/devices/${device.id}/switches/0`)
      .send({})
      .expect(400);
  });

  it('le- és visszakapcsolható, törléskor kijelentkezik', async () => {
    await startApp();
    const device = await createDevice({
      name: 'Ki-be',
      type: 'shelly-1pm',
      shelly: { generation: 3, mac: MAC },
    });
    const id = device.shelly!.deviceId;
    const server = app.getHttpServer();

    const off = await request(server)
      .post(`/api/devices/${device.id}/disconnect`)
      .expect(200);
    expect(off.body).toMatchObject({ enabled: false, status: 'offline' });
    await waitFor(
      () => broker.last(`${id}/online`) === 'false',
      'offline üzenet',
    );

    // Lekapcsolva nem válaszol.
    await control.publishAsync(`${id}/command/switch:0`, 'on');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(app.get(SimulationService).get(device.id)?.switches[0].output).toBe(
      false,
    );

    const on = await request(server)
      .post(`/api/devices/${device.id}/connect`)
      .expect(200);
    expect(on.body).toMatchObject({ enabled: true, status: 'online' });
    await waitFor(() => broker.last(`${id}/online`) === 'true', 'újra online');

    await request(server).delete(`/api/devices/${device.id}`).expect(204);
    await waitFor(
      () => broker.last(`${id}/online`) === 'false',
      'offline törléskor',
    );
    await request(server).get(`/api/devices/${device.id}`).expect(404);
    await request(server).get('/api/devices').expect(200).expect([]);
  });

  it('a topic-előtag módosításakor az eszköz átköltözik', async () => {
    await startApp();
    const device = await createDevice({
      name: 'Költöző',
      type: 'shelly-1pm',
      shelly: { generation: 3, mac: MAC },
    });
    const id = device.shelly!.deviceId;
    await waitFor(() => broker.last(`${id}/online`) === 'true', 'online');

    const renamed = await request(app.getHttpServer())
      .patch(`/api/devices/${device.id}`)
      .send({ name: 'Új név' })
      .expect(200);
    expect(renamed.body.name).toBe('Új név');
    // Puszta átnevezés nem jár ki- és bejelentkezéssel.
    expect(broker.last(`${id}/online`)).toBe('true');

    await request(app.getHttpServer())
      .patch(`/api/devices/${device.id}`)
      .send({ shelly: { topicPrefix: 'uj/elotag' } })
      .expect(200);
    await waitFor(
      () => broker.last('uj/elotag/online') === 'true',
      'online az új előtagon',
    );
    expect(broker.last(`${id}/online`)).toBe('false');

    await control.publishAsync('uj/elotag/command/switch:0', 'on');
    await waitFor(
      () =>
        app.get(SimulationService).get(device.id)?.switches[0].output === true,
      'kapcsolás az új előtagon',
    );
  });

  it('ütköző azonosítóra és előtagra 409-et, hibás törzsre 400-at ad', async () => {
    await startApp();
    const server = app.getHttpServer();
    await createDevice({
      name: 'A',
      type: 'shelly-1pm',
      shelly: { generation: 3, mac: MAC },
    });

    await request(server)
      .post('/api/devices')
      .send({
        name: 'B',
        type: 'shelly-1pm',
        shelly: { generation: 3, mac: MAC },
      })
      .expect(409);
    await request(server)
      .post('/api/devices')
      .send({
        name: 'C',
        type: 'shelly-1pm',
        shelly: { generation: 3, topicPrefix: `shelly1pmg3-${MAC}` },
      })
      .expect(409);

    for (const body of [
      { name: 'T', type: 'tasmota', shelly: { generation: 3 } },
      { name: 'G', type: 'shelly-1pm', shelly: { generation: 1 } },
      { name: 'M', type: 'shelly-1pm', shelly: { generation: 3, mac: 'xyz' } },
      {
        name: 'P',
        type: 'shelly-1pm',
        shelly: { generation: 3, topicPrefix: 'a/#' },
      },
      { name: '', type: 'shelly-1pm', shelly: { generation: 3 } },
      { name: 'N', type: 'shelly-1pm' },
    ]) {
      await request(server).post('/api/devices').send(body).expect(400);
    }
  });

  it('újraindítás után megmaradnak az eszközök és az állapotuk', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'iot-sim-'));
    try {
      await startApp({ DATA_DIR: dataDir });
      const device = await createDevice({
        name: 'Tartós',
        type: 'shelly-2pm',
        shelly: { generation: 3, mac: MAC },
      });
      await request(app.getHttpServer())
        .put(`/api/devices/${device.id}/switches/1`)
        .send({ output: true })
        .expect(200);
      await app.close();

      broker.clear();
      await startApp({ DATA_DIR: dataDir });
      const list = await request(app.getHttpServer())
        .get('/api/devices')
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({
        id: device.id,
        status: 'online',
        switches: [{ output: false }, { output: true, source: 'button' }],
      });
      const id = device.shelly!.deviceId;
      await waitFor(
        () => broker.last(`${id}/status/switch:1`) !== undefined,
        'állapot újraindítás után',
      );
      expect(JSON.parse(broker.last(`${id}/status/switch:1`)!).output).toBe(
        true,
      );
    } finally {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
