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
const ID = `shelly1pmg3-${MAC}`;

interface SwitchStatus {
  apower: number;
  current: number;
  voltage: number;
  pf: number;
  freq: number;
  aenergy: { total: number; by_minute: number[] };
}

describe('Mérési modell (e2e)', () => {
  let broker: TestBroker;
  let app: INestApplication<App>;
  let control: MqttClient;
  let inbox: Array<{ topic: string; payload: string }>;
  let device: DeviceView;

  async function startApp(env: Record<string, string> = {}): Promise<void> {
    app = await createApp({ MQTT_URL: broker.url, ...env });
    await waitFor(
      () => app.get(MqttGateway).isConnected,
      'a közös kapcsolat felépül',
    );
  }

  async function createDevice(): Promise<DeviceView> {
    const res = await request(app.getHttpServer())
      .post('/api/devices')
      .send({
        name: 'Bojler',
        type: 'shelly-1pm',
        shelly: { generation: 3, mac: MAC },
      })
      .expect(201);
    return res.body as DeviceView;
  }

  function meter(body: object) {
    return request(app.getHttpServer())
      .put(`/api/devices/${device.id}/switches/0/meter`)
      .send(body);
  }

  function switchOn() {
    return request(app.getHttpServer())
      .put(`/api/devices/${device.id}/switches/0`)
      .send({ output: true })
      .expect(200);
  }

  function notifications(): Array<{
    params: Record<string, Record<string, unknown>>;
  }> {
    return inbox
      .filter((m) => m.topic === `${ID}/events/rpc`)
      .map((m) => JSON.parse(m.payload));
  }

  async function rpc(
    method: string,
    params: object,
  ): Promise<{ result: unknown }> {
    const id = Math.floor(Math.random() * 1e9);
    await control.publishAsync(
      `${ID}/rpc`,
      JSON.stringify({ id, src: 'teszt', method, params }),
    );
    let response: { id: number; result: unknown } | undefined;
    await waitFor(() => {
      response = inbox
        .filter((m) => m.topic === 'teszt/rpc')
        .map((m) => JSON.parse(m.payload))
        .find((r) => r.id === id);
      return response !== undefined;
    }, `válasz a(z) ${method} hívásra`);
    return response!;
  }

  async function status(): Promise<SwitchStatus> {
    return (await rpc('Switch.GetStatus', { id: 0 })).result as SwitchStatus;
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

  it('a terhelés bekapcsolva jelenik meg, és értesítést küld', async () => {
    await startApp();
    device = await createDevice();

    const res = await meter({ loadPower: 1200, voltage: 230 }).expect(200);
    expect(res.body.switches[0].meter).toMatchObject({
      loadPower: 1200,
      voltage: 230,
    });
    // Kikapcsolva a jelentett teljesítmény 0, ezért nincs mit jelenteni.
    expect((await status()).apower).toBe(0);
    expect(notifications()).toEqual([]);

    await switchOn();
    await waitFor(
      () => notifications().length > 0,
      'NotifyStatus a bekapcsolásról',
    );
    expect(notifications()[0].params['switch:0']).toMatchObject({
      output: true,
      apower: 1200,
      current: 5.217,
    });

    await meter({ loadPower: 460, powerFactor: 0.5 }).expect(200);
    await waitFor(
      () => notifications().length > 1,
      'NotifyStatus a terhelésváltozásról',
    );
    expect(notifications()[1].params['switch:0']).toEqual({
      id: 0,
      apower: 460,
      current: 4,
      pf: 0.5,
    });
    expect(await status()).toMatchObject({
      apower: 460,
      current: 4,
      pf: 0.5,
      voltage: 230,
    });
  });

  it('a kézzel megadott áramerősség felülírja a számoltat', async () => {
    await startApp();
    device = await createDevice();
    await switchOn();
    await meter({ loadPower: 100, currentOverride: 2.5 }).expect(200);
    expect((await status()).current).toBe(2.5);
    await meter({ currentOverride: null }).expect(200);
    expect((await status()).current).toBe(0.435);
  });

  it('a számláló időarányosan nő, beállítható és nullázható', async () => {
    await startApp();
    device = await createDevice();
    await meter({ loadPower: 3600 }).expect(200); // 1 Wh másodpercenként
    await switchOn();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const total = (await status()).aenergy.total;
    expect(total).toBeGreaterThanOrEqual(1);
    expect(total).toBeLessThan(2);

    await meter({ energyTotalWh: 5000 }).expect(200);
    expect((await status()).aenergy.total).toBeGreaterThanOrEqual(5000);

    const reset = (await rpc('Switch.ResetCounters', { id: 0 })).result as {
      aenergy: { total: number };
    };
    expect(reset.aenergy.total).toBeGreaterThanOrEqual(5000);
    expect((await status()).aenergy.total).toBeLessThan(1);

    await meter({ energyTotalWh: 10 }).expect(200);
    const res = await request(app.getHttpServer())
      .post(`/api/devices/${device.id}/switches/0/meter/reset`)
      .expect(200);
    expect(res.body.switches[0].meter.energyTotalWh).toBe(0);
  });

  it('minden egész percben jelenti a számlálót és a percenkénti bontást', async () => {
    await startApp();
    device = await createDevice();
    await meter({ loadPower: 3600 }).expect(200);
    await switchOn();
    inbox.length = 0;

    const simulation = app.get(SimulationService);
    simulation.pauseClock();
    const start = Math.floor(Date.now() / 60_000) * 60_000 + 60_000;
    const minuteReports = () =>
      notifications().filter(
        (n) => n.params['switch:0']?.aenergy !== undefined,
      );

    simulation.tick(new Date(start - 59_000)); // az első ütés csak alapot vesz fel
    simulation.tick(new Date(start + 1_000));
    simulation.tick(new Date(start + 30_000)); // ugyanabban a percben: nincs új jelentés
    await waitFor(() => minuteReports().length === 1, 'első percjelentés');

    simulation.tick(new Date(start + 61_000));
    await waitFor(
      () => minuteReports().length === 2,
      'percenkénti NotifyStatus',
    );
    const aenergy = minuteReports()[1].params['switch:0']
      .aenergy as SwitchStatus['aenergy'];
    // 3600 W egy percig: 60 Wh = 60 000 mWh.
    expect(aenergy.by_minute[0]).toBeCloseTo(60_000, -2);
    expect(aenergy.by_minute[1]).toBeGreaterThan(0);
    expect(aenergy.by_minute[2]).toBe(0);
    expect(aenergy.total).toBeGreaterThan(60);
    await waitFor(
      () => inbox.some((m) => m.topic === `${ID}/status/switch:0`),
      'status/switch:0 a percváltáskor',
    );
  });

  it('hibás mérőértékre 400-at ad', async () => {
    await startApp();
    device = await createDevice();
    for (const body of [
      { loadPower: -1 },
      { voltage: 400 },
      { powerFactor: 1.5 },
      { frequency: 10 },
      { energyTotalWh: -5 },
      { loadPower: 'sok' },
      { ismeretlen: 1 },
    ]) {
      await meter(body).expect(400);
    }
    await request(app.getHttpServer())
      .put(`/api/devices/${device.id}/switches/1/meter`)
      .send({ loadPower: 1 })
      .expect(404);
  });

  it('a leállás alatt a számláló áll, utána tovább nő', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'iot-sim-'));
    try {
      await startApp({ DATA_DIR: dataDir });
      device = await createDevice();
      await meter({ loadPower: 3600 }).expect(200);
      await switchOn();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await app.close();

      // Egy másodperc „leállás” 3600 W mellett 1 Wh lenne, ha számítana.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await startApp({ DATA_DIR: dataDir });
      const list = await request(app.getHttpServer())
        .get('/api/devices')
        .expect(200);
      const total = list.body[0].switches[0].meter.energyTotalWh as number;
      expect(total).toBeGreaterThanOrEqual(0.4);
      expect(total).toBeLessThan(0.9);

      // Újraindítás után a kimenet bekapcsolva marad, a számláló tovább nő.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect((await status()).aenergy.total).toBeGreaterThan(total);
    } finally {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
