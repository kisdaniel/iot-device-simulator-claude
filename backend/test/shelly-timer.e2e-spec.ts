import type { DeviceView } from '@iot-sim/shared';
import type { INestApplication } from '@nestjs/common';
import { connectAsync, type MqttClient } from 'mqtt';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { MqttGateway } from '../src/mqtt/mqtt-gateway.service.js';
import { SimulationService } from '../src/simulation/simulation.service.js';
import { createApp, TestBroker, waitFor } from './helpers.js';

const DEVICE = 'shelly1pmg3-a8032abe54dc';

describe('Shelly időzített visszakapcsolás (e2e)', () => {
  let broker: TestBroker;
  let app: INestApplication<App>;
  let control: MqttClient;
  let simulation: SimulationService;
  let device: DeviceView;
  let inbox: Array<{ topic: string; payload: string }>;

  const statuses = () =>
    inbox
      .filter((m) => m.topic === `${DEVICE}/status/switch:0`)
      .map((m) => JSON.parse(m.payload) as Record<string, unknown>);
  const lastStatus = () => statuses().at(-1)!;
  const notifications = () =>
    inbox
      .filter((m) => m.topic === `${DEVICE}/events/rpc`)
      .map((m) => JSON.parse(m.payload) as { params: Record<string, unknown> });

  async function rpc(
    method: string,
    params: object,
  ): Promise<Record<string, unknown>> {
    const id = Math.floor(Math.random() * 1e9);
    await control.publishAsync(
      `${DEVICE}/rpc`,
      JSON.stringify({ id, src: 'teszt', method, params }),
    );
    let response: Record<string, unknown> | undefined;
    await waitFor(() => {
      response = inbox
        .filter((m) => m.topic === 'teszt/rpc')
        .map((m) => JSON.parse(m.payload) as Record<string, unknown>)
        .find((r) => r.id === id);
      return response !== undefined;
    }, `válasz a(z) ${method} hívásra`);
    return response!;
  }

  /** Megvárja a következő állapotüzenetet a kapcsolóról. */
  async function nextStatus(
    after: number,
    what: string,
  ): Promise<Record<string, unknown>> {
    await waitFor(() => statuses().length > after, what);
    return lastStatus();
  }

  /** A közös óra kézi léptetése a mostanihoz képest. */
  const tickIn = (ms: number) => simulation.tick(new Date(Date.now() + ms));

  const output = async () =>
    (
      (
        await request(app.getHttpServer())
          .get(`/api/devices/${device.id}`)
          .expect(200)
      ).body as DeviceView
    ).switches[0];

  beforeEach(async () => {
    broker = await new TestBroker().start();
    control = await connectAsync(broker.url);
    inbox = [];
    control.on('message', (topic, payload) =>
      inbox.push({ topic, payload: payload.toString() }),
    );
    await control.subscribeAsync(['teszt/rpc', `${DEVICE}/#`]);
    app = await createApp({ MQTT_URL: broker.url });
    const gateway = app.get(MqttGateway);
    await waitFor(() => gateway.isConnected, 'a közös kapcsolat felépül');
    simulation = app.get(SimulationService);
    simulation.pauseClock();
    device = (
      await request(app.getHttpServer())
        .post('/api/devices')
        .send({
          name: 'Bojler',
          type: 'shelly-1pm',
          shelly: { generation: 3, mac: 'a8032abe54dc' },
        })
        .expect(201)
    ).body as DeviceView;
    await waitFor(() => statuses().length > 0, 'a kezdő állapot');
  });

  afterEach(async () => {
    await control.endAsync(true);
    await app?.close();
    await broker.stop();
  });

  it('Switch.Set toggle_after: bekapcsol, az állapotban látszik az időzítő, lejáratkor visszakapcsol', async () => {
    const seen = statuses().length;
    expect(
      await rpc('Switch.Set', { id: 0, on: true, toggle_after: 5 }),
    ).toMatchObject({
      result: { was_on: false },
    });
    const started = await nextStatus(seen, 'a bekapcsolt állapot');
    expect(started).toMatchObject({
      output: true,
      source: 'MQTT',
      timer_duration: 5,
      timer_type: 'toggle_after',
    });
    expect(started.timer_started_at).toBeCloseTo(Date.now() / 1000, -1);
    expect(notifications().at(-1)!.params['switch:0']).toMatchObject({
      output: true,
      timer_duration: 5,
      timer_type: 'toggle_after',
    });
    expect((await rpc('Switch.GetStatus', { id: 0 })).result).toMatchObject({
      timer_duration: 5,
    });

    // Lejárat előtt nem történik semmi.
    tickIn(4_000);
    expect((await output()).output).toBe(true);

    const before = statuses().length;
    tickIn(6_000);
    const flipped = await nextStatus(before, 'a visszakapcsolt állapot');
    expect(flipped).toMatchObject({ output: false, source: 'timer' });
    expect(flipped).not.toHaveProperty('timer_duration');
    expect(flipped).not.toHaveProperty('timer_started_at');
    expect((await output()).source).toBe('timer');
    const status = (await rpc('Switch.GetStatus', { id: 0 })).result as Record<
      string,
      unknown
    >;
    expect(status).not.toHaveProperty('timer_type');
  });

  it('a parancstopicon on,<mp> és off,<mp>; egy újabb kapcsolás megszakítja az időzítőt', async () => {
    let seen = statuses().length;
    await control.publishAsync(`${DEVICE}/command/switch:0`, 'on,3');
    expect(await nextStatus(seen, 'on,3')).toMatchObject({
      output: true,
      timer_duration: 3,
    });

    // A felületi kapcsolás megszakítja az időzítőt: lejáratkor sincs visszakapcsolás.
    seen = statuses().length;
    await request(app.getHttpServer())
      .put(`/api/devices/${device.id}/switches/0`)
      .send({ output: false })
      .expect(200);
    expect(await nextStatus(seen, 'a felületi kikapcsolás')).not.toHaveProperty(
      'timer_duration',
    );
    tickIn(10_000);
    expect((await output()).output).toBe(false);

    // off,<mp> kikapcsolt kimenetnél is elindítja az időzítőt, és bekapcsol.
    seen = statuses().length;
    await control.publishAsync(`${DEVICE}/command/switch:0`, 'off,2.5');
    expect(await nextStatus(seen, 'off,2.5')).toMatchObject({
      output: false,
      timer_duration: 2.5,
    });
    seen = statuses().length;
    tickIn(3_000);
    expect(await nextStatus(seen, 'a visszakapcsolás')).toMatchObject({
      output: true,
      source: 'timer',
    });
  });

  it('az új időzítő a régi helyére lép; MQTT-kapcsolás időzítő nélkül megszakítja', async () => {
    await rpc('Switch.Set', { id: 0, on: true, toggle_after: 2 });
    await rpc('Switch.Set', { id: 0, on: true, toggle_after: 60 });
    expect(lastStatus()).toMatchObject({ output: true, timer_duration: 60 });
    tickIn(5_000);
    expect((await output()).output).toBe(true);

    await rpc('Switch.Toggle', { id: 0 });
    await rpc('Switch.Set', { id: 0, on: true });
    tickIn(120_000);
    expect((await output()).output).toBe(true);
    expect(lastStatus()).not.toHaveProperty('timer_duration');
  });

  it('érvénytelen toggle_after: hiba, és nem kapcsol', async () => {
    for (const value of [0, -1, 'x']) {
      expect(
        await rpc('Switch.Set', { id: 0, on: true, toggle_after: value }),
      ).toMatchObject({
        error: { code: -103, message: "Invalid argument 'toggle_after'!" },
      });
    }
    expect((await output()).output).toBe(false);
    await control.publishAsync(`${DEVICE}/command/switch:0`, 'on,abc');
    await waitFor(
      () => inbox.some((m) => m.topic === `${DEVICE}/error/switch:0`),
      'hibaüzenet',
    );
    expect((await output()).output).toBe(false);
  });
});
