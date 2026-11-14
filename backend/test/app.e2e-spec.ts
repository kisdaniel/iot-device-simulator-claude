import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createApp, TestBroker } from './helpers.js';

describe('API váz (e2e)', () => {
  let app: INestApplication<App>;

  afterEach(async () => {
    await app?.close();
  });

  it('GET /api/health', async () => {
    app = await createApp();
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(res.body).toMatchObject({ status: 'ok', mqtt: expect.any(String) });
  });

  it('GET /api/devices üres listát ad friss adatbázisra', async () => {
    app = await createApp();
    await request(app.getHttpServer())
      .get('/api/devices')
      .expect(200)
      .expect([]);
  });

  describe('brokerbeállítás', () => {
    it('alapértéket ad, és a mentett jelszót nem adja vissza', async () => {
      app = await createApp();
      const server = app.getHttpServer();

      const initial = await request(server).get('/api/broker').expect(200);
      expect(initial.body).toMatchObject({
        host: 'localhost',
        port: 1883,
        tls: false,
        username: null,
        hasPassword: false,
        managedByEnv: false,
        connection: { status: expect.any(String) },
      });

      const saved = await request(server)
        .put('/api/broker')
        .send({
          host: 'broker.invalid',
          port: 8883,
          tls: true,
          username: 'sim',
          password: 'titok',
        })
        .expect(200);
      expect(saved.body).toMatchObject({
        host: 'broker.invalid',
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
        .send({
          host: 'broker.invalid',
          port: 1883,
          tls: false,
          username: 'sim',
        })
        .expect(200);
      expect(kept.body.hasPassword).toBe(true);
    });

    it('hibás törzsre 400-at ad', async () => {
      app = await createApp();
      await request(app.getHttpServer())
        .put('/api/broker')
        .send({ host: 'mqtt://x', port: 70000, tls: 'igen' })
        .expect(400);
    });

    it('környezeti változóból jövő beállítás nem módosítható', async () => {
      app = await createApp({ MQTT_URL: 'mqtt://127.0.0.1:1' });
      const server = app.getHttpServer();
      const view = await request(server).get('/api/broker').expect(200);
      expect(view.body).toMatchObject({
        host: '127.0.0.1',
        port: 1,
        managedByEnv: true,
      });
      await request(server)
        .put('/api/broker')
        .send({ host: 'other', port: 1883, tls: false })
        .expect(409);
    });
  });

  describe('próbakapcsolat', () => {
    const broker = new TestBroker();

    beforeAll(async () => {
      await broker.start();
    });

    afterAll(async () => {
      await broker.stop();
    });

    it('sikeres, ha a broker elérhető', async () => {
      app = await createApp();
      await request(app.getHttpServer())
        .post('/api/broker/test')
        .send({ host: '127.0.0.1', port: broker.port, tls: false })
        .expect(200)
        .expect({ ok: true });
    });

    it('hibát jelez, ha a broker nem érhető el', async () => {
      app = await createApp();
      const res = await request(app.getHttpServer())
        .post('/api/broker/test')
        .send({ host: '127.0.0.1', port: 1, tls: false })
        .expect(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toEqual(expect.any(String));
    });
  });
});
