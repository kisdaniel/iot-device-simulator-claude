import { get as httpGet } from 'node:http';
import type { AddressInfo, Server } from 'node:net';
import {
  type Device,
  SIMULATOR_STATUS_TOPIC,
  type SimEvent,
} from '@iot-sim/shared';
import type { INestApplication } from '@nestjs/common';
import { connectAsync, type MqttClient } from 'mqtt';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { EventBus } from '../src/events/event-bus.service.js';
import { MqttGateway } from '../src/mqtt/mqtt-gateway.service.js';
import type { DeviceProfile } from '../src/simulation/device-profile.js';
import { ProfileRegistry } from '../src/simulation/profile-registry.js';
import { SimulationService } from '../src/simulation/simulation.service.js';
import { createApp, TestBroker, waitFor } from './helpers.js';

/** Minimális profil a mag teszteléséhez: LWT, egy parancs visszhangja, óraütés. */
const echoProfile: DeviceProfile = {
  type: 'tasmota',
  subscriptions: (device) => [
    `cmnd/${device.tasmota!.topic}/#`,
    'cmnd/tasmotas/#',
  ],
  onStart: (ctx) => {
    ctx.publish(`tele/${ctx.device.tasmota!.topic}/LWT`, 'Online', {
      retain: true,
    });
  },
  onStop: (ctx) => {
    ctx.publish(`tele/${ctx.device.tasmota!.topic}/LWT`, 'Offline', {
      retain: true,
    });
  },
  onMessage: (ctx, topic, payload) => {
    if (payload.toString() === 'BOOM') throw new Error('szándékos hiba');
    ctx.publish(`stat/${ctx.device.tasmota!.topic}/RESULT`, {
      command: topic.split('/').at(-1),
      payload: payload.toString(),
    });
  },
  onSwitchChanged: () => undefined,
  onTick: (ctx, now) => {
    ctx.publish(`tele/${ctx.device.tasmota!.topic}/TICK`, now.toISOString());
  },
};

function fakeDevice(topic: string, enabled = true): Device {
  return {
    id: `id-${topic}`,
    name: topic,
    type: 'tasmota',
    enabled,
    tasmota: {
      mac: 'A8032ABE54DC',
      topic,
      fullTopic: '%prefix%/%topic%/',
      groupTopic: 'tasmotas',
      relayCount: 1,
      hasEnergy: false,
      sensorCount: 0,
      discovery: false,
      telePeriod: 300,
      publishOnChange: true,
      powerRetain: false,
    },
    switches: [{ index: 0, output: false, source: 'init' }],
    sensors: [],
  };
}

describe('Szimulációs mag (e2e)', () => {
  let broker: TestBroker;
  let app: INestApplication<App>;
  let control: MqttClient | undefined;

  async function startApp(env: Record<string, string> = {}) {
    app = await createApp({ MQTT_URL: broker.url, ...env });
    app.get(ProfileRegistry).register(echoProfile);
    const gateway = app.get(MqttGateway);
    await waitFor(() => gateway.isConnected, 'a közös kapcsolat felépül');
    return { gateway, simulation: app.get(SimulationService) };
  }

  beforeEach(async () => {
    broker = await new TestBroker().start();
  });

  afterEach(async () => {
    await control?.endAsync(true);
    control = undefined;
    await app?.close();
    await broker.stop();
  });

  it('egyetlen kapcsolaton jelzi a szimulátor állapotát, leálláskor offline-t küld', async () => {
    await startApp();
    await waitFor(
      () => broker.last(SIMULATOR_STATUS_TOPIC) === 'online',
      'a szimulátor online állapota megjelenik',
    );
    const health = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(health.body.mqtt).toBe('connected');

    await app.close();
    expect(broker.last(SIMULATOR_STATUS_TOPIC)).toBe('offline');
  });

  it('az eszköz indításkor bejelentkezik, parancsra válaszol, leállításkor kijelentkezik', async () => {
    const { simulation } = await startApp();
    simulation.load(fakeDevice('t1'));
    await waitFor(
      () => broker.last('tele/t1/LWT') === 'Online',
      't1 bejelentkezik',
    );
    expect(simulation.get('id-t1')?.status).toBe('online');

    control = await connectAsync(broker.url);
    await control.publishAsync('cmnd/t1/POWER', 'ON');
    await waitFor(
      () => broker.last('stat/t1/RESULT') !== undefined,
      't1 válaszol',
    );
    expect(JSON.parse(broker.last('stat/t1/RESULT')!)).toEqual({
      command: 'POWER',
      payload: 'ON',
    });

    const log = await request(app.getHttpServer())
      .get('/api/devices/id-t1/messages')
      .expect(200);
    expect(
      log.body.map((m: { direction: string; topic: string }) => [
        m.direction,
        m.topic,
      ]),
    ).toEqual([
      ['out', 'tele/t1/LWT'],
      ['in', 'cmnd/t1/POWER'],
      ['out', 'stat/t1/RESULT'],
    ]);

    expect(simulation.unload('id-t1')).toBe(true);
    await waitFor(
      () => broker.last('tele/t1/LWT') === 'Offline',
      't1 kijelentkezik',
    );
    await request(app.getHttpServer())
      .get('/api/devices/id-t1/messages')
      .expect(404);
  });

  it('a parancs csak a címzett eszközhöz jut el, a közös topic mindegyikhez', async () => {
    const { simulation } = await startApp();
    simulation.load(fakeDevice('t1'));
    simulation.load(fakeDevice('t2'));
    await waitFor(
      () => broker.last('tele/t2/LWT') === 'Online',
      'mindkét eszköz bejelentkezik',
    );
    broker.clear();

    control = await connectAsync(broker.url);
    await control.publishAsync('cmnd/t2/POWER', 'OFF');
    await waitFor(
      () => broker.last('stat/t2/RESULT') !== undefined,
      't2 válaszol',
    );
    expect(broker.last('stat/t1/RESULT')).toBeUndefined();

    await control.publishAsync('cmnd/tasmotas/STATE', '');
    await waitFor(
      () =>
        broker.published.filter((m) => m.payload.includes('STATE')).length ===
        2,
      'a csoporttopicra mindkét eszköz válaszol',
    );
  });

  it('a lekapcsolt eszköz nem jelentkezik be és nem fogad üzenetet', async () => {
    const { simulation } = await startApp();
    simulation.load(fakeDevice('off', false));
    control = await connectAsync(broker.url);
    await control.publishAsync('cmnd/off/POWER', 'ON');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(broker.last('tele/off/LWT')).toBeUndefined();
    expect(broker.last('stat/off/RESULT')).toBeUndefined();
    expect(simulation.get('id-off')?.status).toBe('offline');
  });

  it('egy hibázó profil nem állítja meg az eszközt és a többieket', async () => {
    const { simulation } = await startApp();
    simulation.load(fakeDevice('t1'));
    await waitFor(
      () => broker.last('tele/t1/LWT') === 'Online',
      't1 bejelentkezik',
    );

    control = await connectAsync(broker.url);
    await control.publishAsync('cmnd/t1/POWER', 'BOOM');
    await control.publishAsync('cmnd/t1/POWER', 'ON');
    await waitFor(
      () => broker.last('stat/t1/RESULT') !== undefined,
      't1 a hiba után is válaszol',
    );
  });

  it('a közös óra csak az elérhető eszközöket hívja', async () => {
    const { simulation } = await startApp();
    simulation.load(fakeDevice('t1'));
    simulation.load(fakeDevice('off', false));
    await waitFor(
      () => broker.last('tele/t1/LWT') === 'Online',
      't1 bejelentkezik',
    );

    simulation.tick(new Date('2026-11-14T10:00:00Z'));
    await waitFor(
      () => broker.last('tele/t1/TICK') !== undefined,
      't1 óraütése megjelenik',
    );
    expect(broker.last('tele/t1/TICK')).toBe('2026-11-14T10:00:00.000Z');
    expect(broker.last('tele/off/TICK')).toBeUndefined();
  });

  it('az üzenetnapló mérete korlátos', async () => {
    const { simulation } = await startApp({ MESSAGE_LOG_SIZE: '3' });
    simulation.load(fakeDevice('t1'));
    await waitFor(
      () => broker.last('tele/t1/LWT') === 'Online',
      't1 bejelentkezik',
    );
    for (let i = 0; i < 5; i++) simulation.tick(new Date(2026, 0, 1, 0, 0, i));
    expect(simulation.messages('id-t1')).toHaveLength(3);
  });

  it('a broker kiesése után újracsatlakozik, és az eszközök újra bejelentkeznek', async () => {
    const { gateway, simulation } = await startApp();
    simulation.load(fakeDevice('t1'));
    await waitFor(
      () => broker.last('tele/t1/LWT') === 'Online',
      't1 bejelentkezik',
    );

    const port = broker.port;
    await broker.stop();
    await waitFor(
      () => !gateway.isConnected,
      'a kapcsolat megszakadása észlelhető',
    );
    expect(simulation.get('id-t1')?.status).toBe('offline');

    broker = await new TestBroker().start(port);
    await waitFor(
      () => broker.last('tele/t1/LWT') === 'Online',
      't1 újra bejelentkezik',
      12_000,
    );
    expect(simulation.get('id-t1')?.status).toBe('online');

    // A feliratkozások is visszaálltak.
    control = await connectAsync(broker.url);
    await control.publishAsync('cmnd/t1/POWER', 'ON');
    await waitFor(
      () => broker.last('stat/t1/RESULT') !== undefined,
      't1 újra válaszol',
    );
  }, 20_000);

  it('a brokerbeállítás mentése új kapcsolatot épít', async () => {
    app = await createApp();
    const gateway = app.get(MqttGateway);
    await request(app.getHttpServer())
      .put('/api/broker')
      .send({ host: '127.0.0.1', port: broker.port, tls: false })
      .expect(200);
    await waitFor(() => gateway.isConnected, 'az új brokerhez csatlakozik');
    const view = await request(app.getHttpServer())
      .get('/api/broker')
      .expect(200);
    expect(view.body.connection).toEqual({ status: 'connected' });
  });

  it('az SSE végpont továbbítja az eseményeket', async () => {
    const { simulation } = await startApp();
    await app.listen(0, '127.0.0.1');
    const { port } = (
      app.getHttpServer() as unknown as Server
    ).address() as AddressInfo;

    const received: string[] = [];
    const req = httpGet(
      {
        host: '127.0.0.1',
        port,
        path: '/api/events',
        headers: { accept: 'text/event-stream' },
      },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => received.push(chunk));
      },
    );
    try {
      const busEvents: SimEvent[] = [];
      app
        .get(EventBus)
        .stream()
        .subscribe((e) => busEvents.push(e));
      // Megvárjuk, amíg a kliens feliratkozik, csak utána váltunk ki eseményt.
      await new Promise((resolve) => setTimeout(resolve, 200));

      simulation.load(fakeDevice('t1'));
      await waitFor(
        () => received.join('').includes('mqtt.message'),
        'az SSE-n megjelenik az üzenet',
      );

      const text = received.join('');
      expect(text).toContain('event: device.connection');
      expect(text).toContain('"status":"online"');
      expect(text).toContain('event: mqtt.message');
      expect(text).toContain('"topic":"tele/t1/LWT"');
      expect(busEvents.map((e) => e.type)).toEqual(
        expect.arrayContaining(['device.connection', 'mqtt.message']),
      );
    } finally {
      req.destroy();
    }
  });
});
