import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceView } from '@iot-sim/shared';
import type { INestApplication } from '@nestjs/common';
import { connectAsync, type MqttClient } from 'mqtt';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { MqttGateway } from '../src/mqtt/mqtt-gateway.service.js';
import { isValidDs18b20Address } from '../src/simulation/sensors.js';
import { createApp, TestBroker, waitFor } from './helpers.js';

const MAC = 'a8032abe54dc';
const ID = `shelly2pmg3-${MAC}`;

describe('Shelly Add-on hőmérők (e2e)', () => {
  let broker: TestBroker;
  let app: INestApplication<App>;
  let control: MqttClient;
  let inbox: Array<{ topic: string; payload: string }>;

  async function startApp(env: Record<string, string> = {}): Promise<void> {
    app = await createApp({ MQTT_URL: broker.url, ...env });
    await waitFor(
      () => app.get(MqttGateway).isConnected,
      'a közös kapcsolat felépül',
    );
  }

  async function createDevice(addon: object | undefined): Promise<DeviceView> {
    const res = await request(app.getHttpServer())
      .post('/api/devices')
      .send({
        name: 'Kazán',
        type: 'shelly-2pm',
        shelly: { generation: 3, mac: MAC, addon },
      })
      .expect(201);
    return res.body as DeviceView;
  }

  function sensor(device: DeviceView, index: number, body: object) {
    return request(app.getHttpServer())
      .put(`/api/devices/${device.id}/sensors/${index}`)
      .send(body);
  }

  function received(topic: string): Array<Record<string, unknown>> {
    return inbox
      .filter((m) => m.topic === topic)
      .map((m) => JSON.parse(m.payload));
  }

  async function rpc(
    method: string,
    params?: object,
  ): Promise<Record<string, unknown>> {
    const id = Math.floor(Math.random() * 1e9);
    await control.publishAsync(
      `${ID}/rpc`,
      JSON.stringify({
        id,
        src: 'teszt',
        method,
        ...(params ? { params } : {}),
      }),
    );
    let response: Record<string, unknown> | undefined;
    await waitFor(() => {
      response = received('teszt/rpc').find((r) => r.id === id);
      return response !== undefined;
    }, `válasz a(z) ${method} hívásra`);
    return response!;
  }

  beforeEach(async () => {
    broker = await new TestBroker().start();
    control = await connectAsync(broker.url);
    inbox = [];
    control.on('message', (topic, payload) =>
      inbox.push({ topic, payload: payload.toString() }),
    );
    await control.subscribeAsync('#');
  });

  afterEach(async () => {
    await control.endAsync(true);
    await app?.close();
    await broker.stop();
  });

  it('a hőmérők temperature:100-tól számozódnak, és induláskor jelentenek', async () => {
    await startApp();
    const device = await createDevice({ enabled: true, sensorCount: 3 });
    expect(device.shelly!.addon).toEqual({ enabled: true, sensorCount: 3 });
    expect(device.sensors.map((s) => [s.index, s.tC, s.error])).toEqual([
      [0, 21.5, null],
      [1, 21.5, null],
      [2, 21.5, null],
    ]);
    for (const s of device.sensors)
      expect(isValidDs18b20Address(s.address)).toBe(true);

    await waitFor(
      () => received(`${ID}/status/temperature:102`).length > 0,
      'status/temperature:102 induláskor',
    );
    expect(received(`${ID}/status/temperature:100`)[0]).toEqual({
      id: 100,
      tC: 21.5,
      tF: 70.7,
    });

    const status = (await rpc('Shelly.GetStatus')).result as Record<
      string,
      unknown
    >;
    expect(Object.keys(status)).toEqual(
      expect.arrayContaining([
        'temperature:100',
        'temperature:101',
        'temperature:102',
      ]),
    );
    expect(status).not.toHaveProperty('temperature:103');
  });

  it('a beállított érték értesítést küld, és RPC-n lekérdezhető', async () => {
    await startApp();
    const device = await createDevice({ enabled: true, sensorCount: 2 });

    const res = await sensor(device, 1, { tC: 48.26 }).expect(200);
    expect(res.body.sensors[1].tC).toBe(48.3);

    await waitFor(
      () => received(`${ID}/events/rpc`).length > 0,
      'NotifyStatus',
    );
    expect(received(`${ID}/events/rpc`)[0]).toMatchObject({
      method: 'NotifyStatus',
      params: { 'temperature:101': { id: 101, tC: 48.3, tF: 118.9 } },
    });
    await waitFor(
      () => received(`${ID}/status/temperature:101`).some((s) => s.tC === 48.3),
      'status/temperature:101 az új értékkel',
    );

    expect(await rpc('Temperature.GetStatus', { id: 101 })).toMatchObject({
      result: { id: 101, tC: 48.3, tF: 118.9 },
    });
    expect(await rpc('Temperature.GetConfig', { id: 100 })).toMatchObject({
      result: { id: 100, report_thr_C: 0.5 },
    });
    expect(await rpc('Temperature.GetStatus', { id: 104 })).toMatchObject({
      error: { code: -105 },
    });

    const peripherals = (await rpc('SensorAddon.GetPeripherals')).result as {
      ds18b20: Record<string, { addr: string }>;
    };
    expect(Object.keys(peripherals.ds18b20)).toEqual([
      'temperature:100',
      'temperature:101',
    ]);
    expect(peripherals.ds18b20['temperature:100'].addr).toMatch(
      /^40(:\d{1,3}){7}$/,
    );
  });

  it('szenzorhibánál nincs érték, a hiba megszűnésével visszaáll', async () => {
    await startApp();
    const device = await createDevice({ enabled: true, sensorCount: 1 });
    await sensor(device, 0, { tC: 30 }).expect(200);

    await sensor(device, 0, { error: 'read' }).expect(200);
    expect(await rpc('Temperature.GetStatus', { id: 100 })).toMatchObject({
      result: { id: 100, tC: null, tF: null, errors: ['read'] },
    });

    await sensor(device, 0, { error: null }).expect(200);
    expect(await rpc('Temperature.GetStatus', { id: 100 })).toMatchObject({
      result: { id: 100, tC: 30 },
    });
  });

  it('Add-on nélkül nincs hőmérő, és a SensorAddon metódus sem él', async () => {
    await startApp();
    const device = await createDevice(undefined);
    expect(device.sensors).toEqual([]);
    expect(device.shelly!.addon).toEqual({ enabled: false, sensorCount: 0 });
    await sensor(device, 0, { tC: 20 }).expect(404);
    expect(await rpc('SensorAddon.GetPeripherals')).toMatchObject({
      error: { code: 404 },
    });
  });

  it('az Add-on utólag bekapcsolható és átméretezhető; a meglévő értékek megmaradnak', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'iot-sim-'));
    try {
      await startApp({ DATA_DIR: dataDir });
      const device = await createDevice(undefined);
      const server = app.getHttpServer();

      const on = await request(server)
        .patch(`/api/devices/${device.id}`)
        .send({ shelly: { addon: { enabled: true, sensorCount: 2 } } })
        .expect(200);
      expect(on.body.sensors).toHaveLength(2);
      await sensor(device, 0, { tC: -12.5 }).expect(200);
      await waitFor(
        () => received(`${ID}/status/temperature:101`).length > 0,
        'az újraindult eszköz jelenti az új hőmérőt',
      );

      const grown = await request(server)
        .patch(`/api/devices/${device.id}`)
        .send({ shelly: { addon: { enabled: true, sensorCount: 3 } } })
        .expect(200);
      expect(grown.body.sensors.map((s: { tC: number }) => s.tC)).toEqual([
        -12.5, 21.5, 21.5,
      ]);
      expect(grown.body.sensors[0].address).toBe(on.body.sensors[0].address);

      // Újraindítás után is megmarad.
      await app.close();
      await startApp({ DATA_DIR: dataDir });
      const after = await request(app.getHttpServer())
        .get(`/api/devices/${device.id}`)
        .expect(200);
      expect(after.body.sensors.map((s: { tC: number }) => s.tC)).toEqual([
        -12.5, 21.5, 21.5,
      ]);

      const off = await request(app.getHttpServer())
        .patch(`/api/devices/${device.id}`)
        .send({ shelly: { addon: { enabled: false, sensorCount: 0 } } })
        .expect(200);
      expect(off.body.sensors).toEqual([]);
    } finally {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('hibás bemenetre 400-at ad', async () => {
    await startApp();
    const server = app.getHttpServer();
    for (const addon of [
      { enabled: true, sensorCount: 0 },
      { enabled: true, sensorCount: 6 },
      { enabled: true, sensorCount: 1.5 },
      { enabled: 'igen', sensorCount: 1 },
    ]) {
      await request(server)
        .post('/api/devices')
        .send({
          name: 'X',
          type: 'shelly-1pm',
          shelly: { generation: 3, addon },
        })
        .expect(400);
    }

    const device = await createDevice({ enabled: true, sensorCount: 1 });
    for (const body of [
      { tC: -56 },
      { tC: 126 },
      { tC: 'meleg' },
      { error: 'zárlat' },
      { x: 1 },
    ]) {
      await sensor(device, 0, body).expect(400);
    }
  });
});
