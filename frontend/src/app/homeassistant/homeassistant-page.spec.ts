import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { DeviceView } from '@iot-sim/shared';
import { HomeAssistantPage } from './homeassistant-page';

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

  it('minden eszközzel generál, a kiválasztás szerint szűr, és a letöltés követi', async () => {
    const fixture = TestBed.createComponent(HomeAssistantPage);
    http.expectOne('/api/devices').flush([device('a1', 'Bojler'), device('b2', 'Lámpa')]);
    await fixture.whenStable();
    http
      .expectOne((r) => r.url === '/api/homeassistant/config' && !r.params.has('ids'))
      .flush(result(2));
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
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

    // A compose fül a kiválasztástól függetlenül látszik, a mentési útvonallal együtt.
    const tabs = element.querySelectorAll<HTMLButtonElement>('.nav-link');
    tabs[1].click();
    await fixture.whenStable();
    expect(element.querySelector('pre')?.textContent).toContain('homeassistant: {}');
    expect(element.querySelector('[data-testid="save-hint"]')?.textContent).toContain(
      'homeassistant/packages/iot_simulator.yaml',
    );
    expect(link.getAttribute('href')).toBe('/api/homeassistant/docker-compose.yml');
    expect(link.classList).not.toContain('disabled');
  });
});
