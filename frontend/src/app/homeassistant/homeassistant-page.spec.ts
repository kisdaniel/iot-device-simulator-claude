import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { DeviceView } from '@iot-sim/shared';
import { DEFAULT_COMPOSE_OPTIONS } from '@iot-sim/shared';
import { COMPOSE_DEBOUNCE_MS, HomeAssistantPage } from './homeassistant-page';

function device(id: string, name: string): DeviceView {
  return {
    id,
    name,
    type: 'shelly-1pm',
    enabled: true,
    status: 'online',
    shelly: {
      generation: 3,
      deviceId: `shelly1pmg3-${id}`,
      topicPrefix: null,
      rpcNtf: true,
      statusNtf: true,
      enableControl: true,
      addon: { enabled: false, sensorCount: 0 },
    },
    switches: [{ index: 0, output: false, source: 'init' }],
    sensors: [],
  };
}

const result = (deviceCount: number) => ({
  yaml: 'mqtt:\n  switch: []\n',
  compose: 'services:\n  homeassistant: {}\n',
  deviceCount,
  entityCount: deviceCount,
  warnings: [],
});

describe('HomeAssistantPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HomeAssistantPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  const broker = {
    host: 'localhost',
    port: 1883,
    tls: false,
    username: null,
    hasPassword: false,
    managedByEnv: false,
    connection: { status: 'connected' },
  };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Kiszolgálja az induló kéréseket: eszközök, broker, konfiguráció, alap-compose. */
  async function start(devices = [device('a1', 'Bojler'), device('b2', 'Lámpa')]) {
    const fixture = TestBed.createComponent(HomeAssistantPage);
    http.expectOne('/api/devices').flush(devices);
    await fixture.whenStable();
    http
      .expectOne((r) => r.url === '/api/homeassistant/config' && !r.params.has('ids'))
      .flush(result(devices.length));
    await fixture.whenStable();
    // Az űrlap az előnézettel együtt jelenik meg, és előtölti a külső broker mezőit.
    http.expectOne('/api/broker').flush(broker);
    await sleep(COMPOSE_DEBOUNCE_MS + 50);
    const compose = http.expectOne('/api/homeassistant/compose');
    expect(compose.request.method).toBe('POST');
    expect(compose.request.body).toEqual(DEFAULT_COMPOSE_OPTIONS);
    compose.flush({ compose: 'services:\n  homeassistant: {}\n', warnings: [] });
    await fixture.whenStable();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('minden eszközzel generál, a kiválasztás szerint szűr, és a letöltés követi', async () => {
    const { fixture, element } = await start();
    expect(element.querySelector('pre')?.textContent).toContain('mqtt:');
    expect(element.textContent).toContain('2 eszköz, 2 entitás');

    element.querySelector<HTMLInputElement>('#ha-b2')!.click();
    await fixture.whenStable();
    const req = http.expectOne((r) => r.url === '/api/homeassistant/config');
    expect(req.request.params.get('ids')).toBe('a1');
    req.flush(result(1));
    await fixture.whenStable();

    const link = element.querySelector<HTMLAnchorElement>('a[download]')!;
    expect(link.getAttribute('href')).toBe('/api/homeassistant/config.yaml?ids=a1');

    // Egyik eszköz sem: nincs kérés, mert az üres ids mindet jelentené.
    element.querySelector<HTMLInputElement>('#ha-a1')!.click();
    await fixture.whenStable();
    http.expectNone('/api/homeassistant/config');
    expect(element.querySelector('pre')).toBeNull();
    expect(element.textContent).toContain('Válassz ki legalább egy eszközt.');
    http.verify();
  });

  it('a compose fül a beállítások szerint POST-tal frissül, hibás mezőnél tilt, és a jelszó nem kerül URL-be', async () => {
    const { fixture, element } = await start();
    element.querySelectorAll<HTMLButtonElement>('.nav-link')[1].click();
    await fixture.whenStable();
    expect(element.querySelector('pre')?.textContent).toContain('homeassistant: {}');
    expect(element.querySelector('[data-testid="save-hint"]')?.textContent).toContain(
      'homeassistant/packages/iot_simulator.yaml',
    );
    expect(element.querySelector('[data-testid="data-hint"]')?.textContent).toContain('mosquitto/');
    const download = () =>
      element.querySelector<HTMLButtonElement>('button[data-testid="download"]')!;
    expect(download().disabled).toBe(false);

    // Jelszavas védelem jelszó nélkül: hiba, nincs kérés, a letöltés tiltva.
    element.querySelector<HTMLInputElement>('#composeAuth')!.click();
    await fixture.whenStable();
    await sleep(COMPOSE_DEBOUNCE_MS + 50);
    http.expectNone('/api/homeassistant/compose');
    expect(element.textContent).toContain('A felhasználónév kötelező.');
    expect(download().disabled).toBe(true);

    const type = (selector: string, value: string) => {
      const input = element.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    type('#composeAuthUsername', 'iot');
    type('#composeAuthPassword', 'titok');
    element.querySelector<HTMLInputElement>('#composeNodeRed')!.click();
    await fixture.whenStable();
    await sleep(COMPOSE_DEBOUNCE_MS + 50);
    const req = http.expectOne('/api/homeassistant/compose');
    expect(req.request.urlWithParams).toBe('/api/homeassistant/compose');
    expect(req.request.body).toMatchObject({
      mosquitto: { enabled: true, auth: { username: 'iot', password: 'titok' } },
      nodeRed: { enabled: true },
    });
    req.flush({ compose: 'services: {}\n', warnings: ['A jelszó olvasható formában van.'] });
    await fixture.whenStable();
    expect(element.querySelector('[data-testid="warnings"]')?.textContent).toContain(
      'olvasható formában',
    );
    expect(element.querySelector('[data-testid="data-hint"]')?.textContent).toContain('node-red/');
    expect(download().disabled).toBe(false);

    // A letöltés is POST, a beállításokkal a törzsben.
    URL.createObjectURL = () => 'blob:teszt';
    URL.revokeObjectURL = () => undefined;
    download().click();
    const file = http.expectOne('/api/homeassistant/docker-compose.yml');
    expect(file.request.method).toBe('POST');
    expect(file.request.body.mosquitto.auth.password).toBe('titok');
    file.flush(new Blob(['services: {}']));

    // Fülváltás után a beírt adatok megmaradnak.
    element.querySelectorAll<HTMLButtonElement>('.nav-link')[0].click();
    element.querySelectorAll<HTMLButtonElement>('.nav-link')[1].click();
    await fixture.whenStable();
    expect(element.querySelector<HTMLInputElement>('#composeAuthPassword')!.value).toBe('titok');
    http.verify();
  });
});
