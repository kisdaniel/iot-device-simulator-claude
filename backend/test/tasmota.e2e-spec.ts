import type { DeviceView } from '@iot-sim/shared';
import type { INestApplication } from '@nestjs/common';
import { connectAsync, type MqttClient } from 'mqtt';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { MqttGateway } from '../src/mqtt/mqtt-gateway.service.js';
import { SimulationService } from '../src/simulation/simulation.service.js';
import { createApp, TestBroker, waitFor } from './helpers.js';

const MAC = 'A8032ABE54DC';
const T = 'tasmota_BE54DC';

describe('Tasmota (e2e)', () => {
  let broker: TestBroker;
  let app: INestApplication<App>;
  let control: MqttClient;
  let inbox: Array<{ topic: string; payload: string; retain: boolean }>;

  async function startApp(): Promise<void> {
    app = await createApp({ MQTT_URL: broker.url });
    await waitFor(
      () => app.get(MqttGateway).isConnected,
      'a közös kapcsolat felépül',
    );
  }

  async function createDevice(
    tasmota: object,
    name = 'Mosógép',
  ): Promise<DeviceView> {
    const res = await request(app.getHttpServer())
      .post('/api/devices')
      .send({ name, type: 'tasmota', tasmota })
      .expect(201);
    return res.body as DeviceView;
  }

  function messages(topic: string): string[] {
    return inbox.filter((m) => m.topic === topic).map((m) => m.payload);
  }

  function json(topic: string): Array<Record<string, unknown>> {
    return messages(topic).map((p) => JSON.parse(p));
  }

  /** Parancs küldése, majd várakozás a feltételre. */
  async function command(
    topic: string,
    payload: string,
    until: () => boolean,
    what: string,
  ) {
    await control.publishAsync(topic, payload);
    await waitFor(until, what);
  }

  beforeEach(async () => {
    broker = await new TestBroker().start();
    control = await connectAsync(broker.url);
    inbox = [];
    control.on('message', (topic, payload, packet) =>
      inbox.push({ topic, payload: payload.toString(), retain: packet.retain }),
    );
    await control.subscribeAsync('#');
  });

  afterEach(async () => {
    await control.endAsync(true);
    await app?.close();
    await broker.stop();
  });

  it('induláskor LWT-t, relé-állapotot, STATE-et és SENSOR-t küld', async () => {
    await startApp();
    const device = await createDevice({
      mac: MAC,
      relayCount: 1,
      hasEnergy: true,
      sensorCount: 0,
    });
    expect(device.tasmota).toMatchObject({
      topic: T,
      fullTopic: '%prefix%/%topic%/',
      groupTopic: 'tasmotas',
      telePeriod: 300,
      publishOnChange: true,
      powerRetain: false,
    });
    expect(device.switches).toHaveLength(1);
    expect(device.switches[0].meter).toBeDefined();

    await waitFor(
      () => messages(`tele/${T}/SENSOR`).length > 0,
      'kezdő SENSOR',
    );
    expect(broker.last(`tele/${T}/LWT`)).toBe('Online');
    expect(
      broker.published.find((m) => m.topic === `tele/${T}/LWT`)?.retain,
    ).toBe(true);
    expect(json(`stat/${T}/RESULT`)[0]).toEqual({ POWER: 'OFF' });
    expect(messages(`stat/${T}/POWER`)).toEqual(['OFF']);
    expect(json(`tele/${T}/STATE`)[0]).toMatchObject({
      POWER: 'OFF',
      UptimeSec: expect.any(Number),
      Time: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/),
    });
    expect(json(`tele/${T}/SENSOR`)[0]).toMatchObject({
      ENERGY: {
        Total: 0,
        Today: 0,
        Yesterday: 0,
        Power: 0,
        Voltage: 230,
        Current: 0,
      },
    });
  });

  it('a POWER parancsot a valódi eszköz módján kezeli', async () => {
    await startApp();
    const device = await createDevice({
      mac: MAC,
      relayCount: 1,
      hasEnergy: false,
      sensorCount: 0,
    });
    const result = () => json(`stat/${T}/RESULT`);
    await waitFor(
      () => messages(`tele/${T}/STATE`).length > 0,
      'az indulás üzenetei',
    );
    inbox.length = 0;

    await command(
      `cmnd/${T}/POWER`,
      'on',
      () => result().length === 1,
      'bekapcsolás',
    );
    expect(result()[0]).toEqual({ POWER: 'ON' });
    expect(messages(`stat/${T}/POWER`)).toEqual(['ON']);

    await command(
      `cmnd/${T}/power`,
      'TOGGLE',
      () => result().length === 2,
      'átváltás',
    );
    expect(result()[1]).toEqual({ POWER: 'OFF' });

    await command(
      `cmnd/${T}/POWER1`,
      '1',
      () => result().length === 3,
      'POWER1 = POWER',
    );
    expect(result()[2]).toEqual({ POWER: 'ON' });

    await command(
      `cmnd/${T}/POWER`,
      '',
      () => result().length === 4,
      'lekérdezés',
    );
    expect(result()[3]).toEqual({ POWER: 'ON' });

    await command(
      `cmnd/${T}/POWER2`,
      'ON',
      () => result().length === 5,
      'nem létező relé',
    );
    expect(result()[4]).toEqual({ Command: 'Unknown' });

    await command(
      `cmnd/${T}/VILLOG`,
      '',
      () => result().length === 6,
      'ismeretlen parancs',
    );
    expect(result()[5]).toEqual({ Command: 'Unknown' });

    const view = await request(app.getHttpServer())
      .get(`/api/devices/${device.id}`)
      .expect(200);
    expect(view.body.switches[0]).toMatchObject({
      output: true,
      source: 'MQTT',
    });
  });

  it('több relénél POWER1 … POWERn kulcsokat használ, a csoporttopicra mindenki reagál', async () => {
    await startApp();
    await createDevice({
      mac: MAC,
      relayCount: 3,
      hasEnergy: false,
      sensorCount: 0,
    });
    await createDevice(
      { mac: '111111222222', relayCount: 1, hasEnergy: false, sensorCount: 0 },
      'Lámpa',
    );
    await waitFor(
      () => messages(`stat/${T}/POWER3`).length > 0,
      'POWER3 induláskor',
    );
    inbox.length = 0;

    await command(
      `cmnd/${T}/POWER2`,
      'ON',
      () => json(`stat/${T}/RESULT`).length > 0,
      'POWER2 bekapcsolás',
    );
    expect(json(`stat/${T}/RESULT`)[0]).toEqual({ POWER2: 'ON' });
    expect(messages(`stat/${T}/POWER2`)).toEqual(['ON']);

    // Sorszám nélkül az első relé.
    await command(
      `cmnd/${T}/POWER`,
      'ON',
      () => json(`stat/${T}/RESULT`).length > 1,
      'POWER = POWER1',
    );
    expect(json(`stat/${T}/RESULT`)[1]).toEqual({ POWER1: 'ON' });

    await command(
      'cmnd/tasmotas/POWER1',
      'OFF',
      () =>
        messages('stat/tasmota_222222/POWER').includes('OFF') &&
        messages(`stat/${T}/POWER1`).includes('OFF'),
      'csoportparancs mindkét eszköznek',
    );

    await command(
      `cmnd/${T}/STATE`,
      '',
      () => json(`stat/${T}/RESULT`).some((r) => 'POWER3' in r),
      'STATE',
    );
    expect(json(`stat/${T}/RESULT`).find((r) => 'POWER3' in r)).toMatchObject({
      POWER1: 'OFF',
      POWER2: 'ON',
      POWER3: 'OFF',
    });
  });

  it('egyetlen ENERGY blokk méri az összes relét', async () => {
    await startApp();
    const device = await createDevice({
      mac: MAC,
      relayCount: 2,
      hasEnergy: true,
      sensorCount: 0,
    });
    expect(device.switches.map((s) => s.meter !== undefined)).toEqual([
      true,
      false,
    ]);
    const server = app.getHttpServer();
    await request(server)
      .put(`/api/devices/${device.id}/switches/0/meter`)
      .send({ loadPower: 1200 })
      .expect(200);
    await request(server)
      .put(`/api/devices/${device.id}/switches/1/meter`)
      .send({ loadPower: 1 })
      .expect(400);

    const lastEnergy = () =>
      json(`tele/${T}/SENSOR`).at(-1)?.ENERGY as Record<string, number>;
    expect(lastEnergy()).toMatchObject({ Power: 0, Current: 0 });

    // Csak a második relé van bekapcsolva: a mérő akkor is mér.
    await request(server)
      .put(`/api/devices/${device.id}/switches/1`)
      .send({ output: true })
      .expect(200);
    await waitFor(
      () => lastEnergy()?.Power === 1200,
      'azonnali SENSOR a kapcsolás után',
    );
    expect(lastEnergy()).toMatchObject({
      Power: 1200,
      ApparentPower: 1200,
      ReactivePower: 0,
      Factor: 1,
      Voltage: 230,
      Current: 5.217,
    });
    expect(json(`stat/${T}/RESULT`).at(-1)).toEqual({ POWER2: 'ON' });

    await request(server)
      .put(`/api/devices/${device.id}/switches/0/meter`)
      .send({ powerFactor: 0.5 })
      .expect(200);
    await waitFor(
      () => lastEnergy()?.Factor === 0.5,
      'SENSOR a mérő változásakor',
    );
    expect(lastEnergy()).toMatchObject({
      Power: 1200,
      ApparentPower: 2400,
      ReactivePower: 2078,
    });
  });

  it('a publishOnChange kikapcsolva csak az időszakos jelentés megy ki', async () => {
    await startApp();
    const device = await createDevice({
      mac: MAC,
      relayCount: 1,
      hasEnergy: true,
      sensorCount: 0,
      publishOnChange: false,
      powerRetain: true,
    });
    await waitFor(
      () => messages(`tele/${T}/SENSOR`).length === 1,
      'kezdő SENSOR',
    );
    await request(app.getHttpServer())
      .put(`/api/devices/${device.id}/switches/0`)
      .send({ output: true })
      .expect(200);
    await waitFor(
      () => messages(`stat/${T}/POWER`).includes('ON'),
      'stat/POWER',
    );
    // Élő feliratkozónak a broker a retain jelzőt nem továbbítja: a küldött üzenetet nézzük.
    expect(
      broker.published.find(
        (m) => m.topic === `stat/${T}/POWER` && m.payload === 'ON',
      )?.retain,
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(messages(`tele/${T}/SENSOR`)).toHaveLength(1);
  });

  it('TelePeriod szerint küld STATE-et és SENSOR-t, a Period az azóta fogyasztott Wh', async () => {
    await startApp();
    const simulation = app.get(SimulationService);
    simulation.pauseClock();
    const device = await createDevice({
      mac: MAC,
      relayCount: 1,
      hasEnergy: true,
      sensorCount: 0,
      telePeriod: 60,
    });
    const server = app.getHttpServer();
    await request(server)
      .put(`/api/devices/${device.id}/switches/0/meter`)
      .send({ loadPower: 3600 })
      .expect(200);
    await request(server)
      .put(`/api/devices/${device.id}/switches/0`)
      .send({ output: true })
      .expect(200);
    await waitFor(
      () => messages(`tele/${T}/STATE`).length === 1,
      'kezdő STATE',
    );
    // A bekapcsolás azonnali SENSOR-t vált ki; az időszakosat ezután számoljuk.
    await waitFor(
      () =>
        (json(`tele/${T}/SENSOR`).at(-1)?.ENERGY as { Power: number })
          ?.Power === 3600,
      'azonnali SENSOR a bekapcsolás után',
    );
    const sensors = () => messages(`tele/${T}/SENSOR`).length;
    const before = sensors();

    simulation.tick(new Date(Date.now() + 30_000)); // még nincs esedékes
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(messages(`tele/${T}/STATE`)).toHaveLength(1);

    simulation.tick(new Date(Date.now() + 61_000));
    await waitFor(
      () => messages(`tele/${T}/STATE`).length === 2,
      'időszakos STATE',
    );
    await waitFor(() => sensors() === before + 1, 'időszakos SENSOR');
    const energy = json(`tele/${T}/SENSOR`).at(-1)!.ENERGY as Record<
      string,
      number
    >;
    // 3600 W 61 másodpercig ≈ 61 Wh.
    expect(energy.Period).toBeGreaterThanOrEqual(60);
    expect(energy.Period).toBeLessThanOrEqual(62);
    expect(energy.Total).toBeCloseTo(0.061, 2);
  });

  it('a STATUS és a TELEPERIOD parancsra válaszol, a TelePeriod megmarad', async () => {
    await startApp();
    const device = await createDevice({
      mac: MAC,
      relayCount: 2,
      hasEnergy: true,
      sensorCount: 1,
    });

    await command(
      `cmnd/${T}/STATUS`,
      '10',
      () => json(`stat/${T}/STATUS10`).length > 0,
      'STATUS 10',
    );
    expect(json(`stat/${T}/STATUS10`)[0]).toMatchObject({
      StatusSNS: {
        ENERGY: { Power: 0 },
        DS18B20: { Temperature: 21.5 },
        TempUnit: 'C',
      },
    });
    await command(
      `cmnd/${T}/STATUS`,
      '8',
      () => json(`stat/${T}/STATUS8`).length > 0,
      'STATUS 8',
    );
    await command(
      `cmnd/${T}/Status`,
      '11',
      () => json(`stat/${T}/STATUS11`).length > 0,
      'STATUS 11',
    );
    expect(json(`stat/${T}/STATUS11`)[0]).toMatchObject({
      StatusSTS: { POWER1: 'OFF', POWER2: 'OFF' },
    });
    await command(
      `cmnd/${T}/STATUS`,
      '',
      () => json(`stat/${T}/STATUS`).length > 0,
      'STATUS',
    );
    expect(json(`stat/${T}/STATUS`)[0]).toMatchObject({
      Status: { DeviceName: 'Mosógép', Topic: T, Power: '0' },
    });

    inbox.length = 0;
    await command(
      `cmnd/${T}/TelePeriod`,
      '120',
      () => json(`stat/${T}/RESULT`).length > 0,
      'TelePeriod',
    );
    expect(json(`stat/${T}/RESULT`)[0]).toEqual({ TelePeriod: 120 });
    await command(
      `cmnd/${T}/TELEPERIOD`,
      '5',
      () => json(`stat/${T}/RESULT`).length > 1,
      'alsó határ',
    );
    expect(json(`stat/${T}/RESULT`)[1]).toEqual({ TelePeriod: 10 });
    await waitFor(async () => {
      const res = await request(app.getHttpServer()).get(
        `/api/devices/${device.id}`,
      );
      return res.body.tasmota.telePeriod === 10;
    }, 'a TelePeriod a konfigurációba került');
  });

  it('a DS18B20 hőmérők a SENSOR-ban jelennek meg, hibásan kimaradnak', async () => {
    await startApp();
    const device = await createDevice({
      mac: MAC,
      relayCount: 1,
      hasEnergy: false,
      sensorCount: 2,
    });
    await waitFor(
      () => messages(`tele/${T}/SENSOR`).length > 0,
      'kezdő SENSOR',
    );
    const first = json(`tele/${T}/SENSOR`)[0];
    expect(first).toMatchObject({
      'DS18B20-1': {
        Id: expect.stringMatching(/^[0-9A-F]{12}$/),
        Temperature: 21.5,
      },
      'DS18B20-2': { Temperature: 21.5 },
      TempUnit: 'C',
    });
    expect(first).not.toHaveProperty('ENERGY');

    const server = app.getHttpServer();
    await request(server)
      .put(`/api/devices/${device.id}/sensors/1`)
      .send({ tC: 64.2 })
      .expect(200);
    await waitFor(
      () =>
        (
          json(`tele/${T}/SENSOR`).at(-1)?.['DS18B20-2'] as {
            Temperature: number;
          }
        )?.Temperature === 64.2,
      'SENSOR a hőmérséklet változásakor',
    );

    await request(server)
      .put(`/api/devices/${device.id}/sensors/0`)
      .send({ error: 'read' })
      .expect(200);
    await waitFor(
      () => !('DS18B20-1' in json(`tele/${T}/SENSOR`).at(-1)!),
      'hibás hőmérő kimarad',
    );
  });

  it('a relék, a mérő és a hőmérők száma utólag módosítható', async () => {
    await startApp();
    const device = await createDevice({
      mac: MAC,
      relayCount: 1,
      hasEnergy: true,
      sensorCount: 0,
    });
    const server = app.getHttpServer();
    await request(server)
      .put(`/api/devices/${device.id}/switches/0`)
      .send({ output: true })
      .expect(200);

    const res = await request(server)
      .patch(`/api/devices/${device.id}`)
      .send({ tasmota: { relayCount: 3, sensorCount: 1, hasEnergy: false } })
      .expect(200);
    expect(res.body.switches.map((s: { output: boolean }) => s.output)).toEqual(
      [true, false, false],
    );
    expect(res.body.switches[0].meter).toBeUndefined();
    expect(res.body.sensors).toHaveLength(1);
    // Az újraindult eszköz a három relé állapotát jelenti.
    await waitFor(
      () => messages(`stat/${T}/POWER3`).length > 0,
      'POWER3 az újraindulás után',
    );
    expect(json(`tele/${T}/SENSOR`).at(-1)).toMatchObject({
      DS18B20: { Temperature: 21.5 },
    });

    // Puszta TelePeriod-módosítás nem jár újraindulással.
    const lwt = messages(`tele/${T}/LWT`).length;
    await request(server)
      .patch(`/api/devices/${device.id}`)
      .send({ tasmota: { telePeriod: 30 } })
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(messages(`tele/${T}/LWT`)).toHaveLength(lwt);
  });

  it('egyedi FullTopic és topic', async () => {
    await startApp();
    await createDevice({
      mac: MAC,
      topic: 'kazan',
      fullTopic: 'otthon/%topic%/%prefix%',
      relayCount: 1,
      hasEnergy: false,
      sensorCount: 0,
    });
    await waitFor(
      () => broker.last('otthon/kazan/tele/LWT') === 'Online',
      'LWT az egyedi topicon',
    );
    await command(
      'otthon/kazan/cmnd/POWER',
      'ON',
      () => messages('otthon/kazan/stat/POWER').includes('ON'),
      'kapcsolás az egyedi topicon',
    );
  });

  it('hibás beállításra 400-at, foglalt topicra 409-et ad', async () => {
    await startApp();
    const server = app.getHttpServer();
    const base = { relayCount: 1, hasEnergy: true, sensorCount: 0 };
    for (const tasmota of [
      { ...base, relayCount: 0 },
      { ...base, relayCount: 9 },
      { ...base, sensorCount: 9 },
      { ...base, topic: 'a/b' },
      { ...base, fullTopic: '%topic%/' },
      { ...base, telePeriod: 5 },
      { ...base, topic: 'tasmotas' },
      { relayCount: 1 },
    ]) {
      await request(server)
        .post('/api/devices')
        .send({ name: 'X', type: 'tasmota', tasmota })
        .expect(400);
    }
    await request(server)
      .post('/api/devices')
      .send({ name: 'X', type: 'tasmota' })
      .expect(400);
    await request(server)
      .post('/api/devices')
      .send({
        name: 'X',
        type: 'tasmota',
        tasmota: base,
        shelly: { generation: 3 },
      })
      .expect(400);

    await createDevice({ ...base, mac: MAC });
    await request(server)
      .post('/api/devices')
      .send({ name: 'Y', type: 'tasmota', tasmota: { ...base, topic: T } })
      .expect(409);
  });
});
