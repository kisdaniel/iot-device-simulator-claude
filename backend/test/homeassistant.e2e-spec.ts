import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { parse } from 'yaml';
import { createApp } from './helpers.js';

describe('Home Assistant konfiguráció (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  async function create(body: object): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/devices')
      .send(body)
      .expect(201);
    return res.body.id as string;
  }

  it('a felvett eszközökből készül, szűrhető, és letölthető YAML-ként', async () => {
    const server = app.getHttpServer();
    const shelly = await create({
      name: 'Bojler',
      type: 'shelly-1pm',
      shelly: { generation: 3, mac: 'a8032abe54dc' },
    });
    await create({
      name: 'Mosógép',
      type: 'tasmota',
      tasmota: {
        mac: '111111222222',
        relayCount: 2,
        hasEnergy: false,
        sensorCount: 0,
      },
    });
    await create({
      name: 'Felfedezett',
      type: 'tasmota',
      tasmota: {
        mac: '333333444444',
        relayCount: 1,
        hasEnergy: false,
        sensorCount: 0,
        discovery: true,
      },
    });

    const all = await request(server)
      .get('/api/homeassistant/config')
      .expect(200);
    expect(all.body).toMatchObject({ deviceCount: 2, entityCount: 7 });
    expect(all.body.warnings).toEqual([expect.stringContaining('Felfedezett')]);
    const doc = parse(all.body.yaml, { version: '1.1' });
    expect(
      doc.mqtt.switch.map((s: { device: { name: string } }) => s.device.name),
    ).toEqual(['Bojler', 'Mosógép', 'Mosógép']);
    expect(doc.mqtt.switch.map((s: { name: string | null }) => s.name)).toEqual(
      [null, 'Relé 1', 'Relé 2'],
    );

    const withDiscovered = await request(server)
      .get('/api/homeassistant/config?includeDiscovered=true')
      .expect(200);
    expect(withDiscovered.body.deviceCount).toBe(3);

    const only = await request(server)
      .get(`/api/homeassistant/config?ids=${shelly}`)
      .expect(200);
    expect(only.body).toMatchObject({ deviceCount: 1, warnings: [] });

    const file = await request(server)
      .get('/api/homeassistant/config.yaml')
      .expect(200);
    expect(file.headers['content-type']).toContain('text/yaml');
    expect(file.headers['content-disposition']).toContain(
      'iot-simulator-homeassistant.yaml',
    );
    expect(file.text).toBe(
      all.body.yaml.replace(
        /Generálva: [^;]+/,
        file.text.match(/Generálva: [^;]+/)![0],
      ),
    );
  });

  it('eszközök nélkül üres mqtt blokkot ad', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/homeassistant/config')
      .expect(200);
    expect(res.body).toMatchObject({
      deviceCount: 0,
      entityCount: 0,
      warnings: [],
    });
    expect(parse(res.body.yaml)).toEqual({ mqtt: {} });
  });
});
