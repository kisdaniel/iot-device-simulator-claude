import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { DeviceView } from '@iot-sim/shared';
import { DeviceList } from './device-list';

function device(output: boolean): DeviceView {
  return {
    id: 'd1',
    name: 'Bojler',
    type: 'shelly-1pm',
    enabled: true,
    status: 'online',
    shelly: {
      generation: 3,
      deviceId: 'shelly1pmg3-a8032abe54dc',
      topicPrefix: null,
      rpcNtf: true,
      statusNtf: true,
      enableControl: true,
      addon: { enabled: false, sensorCount: 0 },
    },
    switches: [{ index: 0, output, source: 'init' }],
    sensors: [],
  };
}

describe('DeviceList', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DeviceList],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('kártyát mutat az eszközről a típussal és az azonosítóval', async () => {
    const fixture = TestBed.createComponent(DeviceList);
    http.expectOne('/api/devices').flush([device(false)]);
    await fixture.whenStable();

    const card = (fixture.nativeElement as HTMLElement).querySelector('.card')!;
    expect(card.querySelector('.card-title')?.textContent?.trim()).toBe('Bojler');
    expect(card.textContent).toContain('Shelly 1PM Gen3');
    expect(card.textContent).toContain('shelly1pmg3-a8032abe54dc');
    expect(card.querySelector('.badge')?.textContent).toContain('Elérhető');
  });

  it('a kapcsoló a szerver válasza szerint áll be', async () => {
    const fixture = TestBed.createComponent(DeviceList);
    http.expectOne('/api/devices').flush([device(false)]);
    await fixture.whenStable();

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[role=switch]',
    )!;
    input.click();
    await fixture.whenStable();
    expect(input.checked).toBe(false);

    const req = http.expectOne('/api/devices/d1/switches/0');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ output: true });
    req.flush(device(true));
    await fixture.whenStable();
    expect(input.checked).toBe(true);
  });
});
