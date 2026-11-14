import { createServer, type Server } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Aedes } from 'aedes';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

async function createApp(
  env: Record<string, string>,
): Promise<INestApplication<App>> {
  for (const key of [
    'MQTT_URL',
    'MQTT_USERNAME',
    'MQTT_PASSWORD',
    'DATA_DIR',
  ]) {
    delete process.env[key];
  }
  Object.assign(process.env, { DATA_DIR: ':memory:', ...env });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}

describe('API váz (e2e)', () => {
  let app: INestApplication<App>;

  afterEach(async () => {
    await app?.close();
  });

  it('GET /api/health', async () => {
    app = await createApp({});
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('ok'));
  });

  it('GET /api/devices üres listát ad friss adatbázisra', async () => {
    app = await createApp({});
    await request(app.getHttpServer())
      .get('/api/devices')
      .expect(200)
      .expect([]);
  });

  describe('brokerbeállítás', () => {
    it('alapértéket ad, és a mentett jelszót nem adja vissza', async () => {
      app = await createApp({});
      const server = app.getHttpServer();

      await request(server).get('/api/broker').expect(200).expect({
        host: 'localhost',
        port: 1883,
        tls: false,
        username: null,
        hasPassword: false,
        managedByEnv: false,
      });

      const saved = await request(server)
        .put('/api/broker')
        .send({
          host: 'broker.local',
          port: 8883,
          tls: true,
          username: 'sim',
          password: 'titok',
        })
        .expect(200);
      expect(saved.body).toEqual({
        host: 'broker.local',
        port: 8883,
        tls: true,
        username: 'sim',
        hasPassword: true,
        managedByEnv: false,
      });
      expect(JSON.stringify(saved.body)).not.toContain('titok');

      // Jelszó nélküli mentés megtartja a tárolt jelszót.
      const kept = await request(server)
        .put('/api/broker')
        .send({ host: 'broker.local', port: 1883, tls: false, username: 'sim' })
        .expect(200);
      expect(kept.body.hasPassword).toBe(true);
    });

    it('hibás törzsre 400-at ad', async () => {
      app = await createApp({});
      await request(app.getHttpServer())
        .put('/api/broker')
        .send({ host: 'mqtt://x', port: 70000, tls: 'igen' })
        .expect(400);
    });

    it('környezeti változóból jövő beállítás nem módosítható', async () => {
      app = await createApp({ MQTT_URL: 'mqtt://mosquitto:1883' });
      const server = app.getHttpServer();
      const view = await request(server).get('/api/broker').expect(200);
      expect(view.body).toMatchObject({
        host: 'mosquitto',
        port: 1883,
        managedByEnv: true,
      });
      await request(server)
        .put('/api/broker')
        .send({ host: 'other', port: 1883, tls: false })
        .expect(409);
    });
  });

  describe('próbakapcsolat', () => {
    let broker: Aedes;
    let tcp: Server;
    let port: number;

    beforeAll(async () => {
      broker = await Aedes.createBroker();
      tcp = createServer(broker.handle);
      await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve));
      port = (tcp.address() as { port: number }).port;
    });

    afterAll(async () => {
      await new Promise((resolve) => broker.close(() => resolve(undefined)));
      await new Promise((resolve) => tcp.close(() => resolve(undefined)));
    });

    it('sikeres, ha a broker elérhető', async () => {
      app = await createApp({});
      await request(app.getHttpServer())
        .post('/api/broker/test')
        .send({ host: '127.0.0.1', port, tls: false })
        .expect(200)
        .expect({ ok: true });
    });

    it('hibát jelez, ha a broker nem érhető el', async () => {
      app = await createApp({});
      const res = await request(app.getHttpServer())
        .post('/api/broker/test')
        .send({ host: '127.0.0.1', port: 1, tls: false })
        .expect(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toEqual(expect.any(String));
    });
  });
});
