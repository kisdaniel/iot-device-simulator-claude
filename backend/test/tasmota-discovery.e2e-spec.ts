import type { DeviceView } from '@iot-sim/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { MqttGateway } from '../src/mqtt/mqtt-gateway.service.js';
import { createApp, TestBroker, waitFor } from './helpers.js';

const MAC = 'A8032ABE54DC';
const CONFIG = `tasmota/discovery/${MAC}/config`;
const SENSORS = `tasmota/discovery/${MAC}/sensors`;

describe('Tasmota discovery (e2e)', () => {
  let broker: TestBroker;
  let app: INestApplication<App>;

  async function createDevice(tasmota: object): Promise<DeviceView> {
    const res = await request(app.getHttpServer())
      .post('/api/devices')
      .send({
        name: 'Mosógép',
        type: 'tasmota',
        tasmota: {
          mac: MAC,
          relayCount: 2,
          hasEnergy: true,
          sensorCount: 1,
          ...tasmota,
        },
      })
      .expect(201);
    return res.body as DeviceView;
  }

  function patch(device: DeviceView, body: object) {
    return request(app.getHttpServer())
      .patch(`/api/devices/${device.id}`)
      .send(body)
      .expect(200);
  }

  /** A topicra küldött üzenetek (tartalom és retain) sorrendben. */
  function sent(topic: string) {
    return broker.published.filter((m) => m.topic === topic);
  }

  beforeEach(async () => {
    broker = await new TestBroker().start();
    app = await createApp({ MQTT_URL: broker.url });
    await waitFor(
      () => app.get(MqttGateway).isConnected,
      'a közös kapcsolat felépül',
    );
  });

  afterEach(async () => {
    await app?.close();
    await broker.stop();
  });

  it('alapból nem küld discoveryt', async () => {
    await createDevice({});
    await waitFor(
      () => broker.last('tele/tasmota_BE54DC/LWT') === 'Online',
      'LWT',
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sent(CONFIG)).toEqual([]);
  });

  it('bekapcsolva megőrzött config és sensors üzenetet küld', async () => {
    const device = await createDevice({ discovery: true });
    expect(device.tasmota!.discovery).toBe(true);
    await waitFor(() => sent(SENSORS).length > 0, 'discovery üzenetek');

    expect(sent(CONFIG)[0].retain).toBe(true);
    expect(sent(SENSORS)[0].retain).toBe(true);
    const config = JSON.parse(sent(CONFIG)[0].payload);
    expect(config).toMatchObject({
      dn: 'Mosógép',
      fn: ['Mosógép', 'Mosógép 2', null, null, null, null, null, null],
      hn: 'tasmota-BE54DC-5340',
      mac: MAC,
      ofln: 'Offline',
      onln: 'Online',
      t: 'tasmota_BE54DC',
      ft: '%prefix%/%topic%/',
      tp: ['cmnd', 'stat', 'tele'],
      rl: [1, 1, 0, 0, 0, 0, 0, 0],
      ver: 1,
    });
    // A Home Assistant integráció ezeket a kulcsokat kötelezőnek veszi.
    expect(Object.keys(config.so)).toEqual(
      expect.arrayContaining([
        '4',
        '11',
        '13',
        '17',
        '20',
        '30',
        '68',
        '73',
        '82',
        '114',
        '117',
      ]),
    );
    for (const key of [
      'ip',
      'md',
      'ty',
      'if',
      'state',
      'sw',
      'swc',
      'swn',
      'btn',
      'lk',
      'lt_st',
      'sho',
      'sht',
    ]) {
      expect(config).toHaveProperty(key);
    }

    const sensors = JSON.parse(sent(SENSORS)[0].payload);
    expect(sensors).toMatchObject({
      sn: {
        ENERGY: { Power: 0, Voltage: 230 },
        DS18B20: { Temperature: 21.5 },
        TempUnit: 'C',
      },
      ver: 1,
    });
  });

  it('lekapcsoláskor a discovery megmarad, törléskor üres üzenettel eltűnik', async () => {
    const device = await createDevice({ discovery: true });
    await waitFor(() => sent(SENSORS).length > 0, 'discovery üzenetek');
    const server = app.getHttpServer();

    await request(server)
      .post(`/api/devices/${device.id}/disconnect`)
      .expect(200);
    await waitFor(
      () => broker.last('tele/tasmota_BE54DC/LWT') === 'Offline',
      'LWT Offline',
    );
    expect(sent(CONFIG).every((m) => m.payload !== '')).toBe(true);

    await request(server).delete(`/api/devices/${device.id}`).expect(204);
    await waitFor(
      () => broker.last(CONFIG) === '' && broker.last(SENSORS) === '',
      'törlés',
    );
    expect(sent(CONFIG).at(-1)!.retain).toBe(true);
  });

  it('utólag be- és kikapcsolható; az átnevezés frissíti a config üzenetet', async () => {
    const device = await createDevice({});

    await patch(device, { tasmota: { discovery: true } });
    await waitFor(() => sent(CONFIG).length === 1, 'bekapcsolás után');
    // Puszta beállításváltozás: az eszköz nem indul újra.
    expect(sent('tele/tasmota_BE54DC/LWT').map((m) => m.payload)).toEqual([
      'Online',
    ]);

    await patch(device, { name: 'Szárító' });
    await waitFor(() => sent(CONFIG).length === 2, 'átnevezés után');
    expect(JSON.parse(broker.last(CONFIG)!).dn).toBe('Szárító');

    await patch(device, { tasmota: { discovery: false } });
    await waitFor(
      () => broker.last(CONFIG) === '' && broker.last(SENSORS) === '',
      'kikapcsolás után',
    );
  });

  it('a relék számának változásakor az újraindult eszköz az új szerkezetet közli', async () => {
    const device = await createDevice({ discovery: true });
    await waitFor(() => sent(CONFIG).length === 1, 'kezdő discovery');

    await patch(device, {
      tasmota: { relayCount: 3, hasEnergy: false, sensorCount: 0 },
    });
    await waitFor(
      () => JSON.parse(broker.last(CONFIG) || '{}').rl?.[2] === 1,
      'új relészám a config üzenetben',
    );
    expect(JSON.parse(broker.last(SENSORS)!).sn).not.toHaveProperty('ENERGY');
    // Az újraindulás egyszer küldi el, nem duplán.
    expect(sent(CONFIG)).toHaveLength(2);
  });

  it('lekapcsolt eszközön is eltávolítható a discovery', async () => {
    const device = await createDevice({ discovery: true });
    await waitFor(() => sent(CONFIG).length === 1, 'kezdő discovery');
    await request(app.getHttpServer())
      .post(`/api/devices/${device.id}/disconnect`)
      .expect(200);

    await patch(device, { tasmota: { discovery: false } });
    await waitFor(
      () => broker.last(CONFIG) === '',
      'eltávolítás lekapcsolt eszközön',
    );
  });
});
