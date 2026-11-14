import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { DeviceView } from '@iot-sim/shared';
import { TemperatureEditor } from './temperature-editor';

const device: DeviceView = {
  id: 'd1',
  name: 'Kazán',
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
    addon: { enabled: true, sensorCount: 1 },
  },
  switches: [],
  sensors: [{ index: 0, address: '28FF64061FC795B1', tC: 21.5, error: null }],
};

describe('TemperatureEditor', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TemperatureEditor],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    // A DeviceStore induláskor betölti a listát.
  });

  async function render() {
    const fixture = TestBed.createComponent(TemperatureEditor);
    fixture.componentRef.setInput('device', device);
    fixture.componentRef.setInput('state', device.sensors[0]);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('a mezőből érvényes értéket küld, érvénytelent nem', async () => {
    const element = await render();
    expect(element.textContent).toContain('temperature:100');
    const input = element.querySelector<HTMLInputElement>('input[type=number]')!;

    input.value = '130';
    input.dispatchEvent(new Event('change'));
    http.match('/api/devices/d1/sensors/0').forEach(() => {
      throw new Error('érvénytelen értékre nem mehet kérés');
    });

    input.value = '48.3';
    input.dispatchEvent(new Event('change'));
    const req = http.expectOne('/api/devices/d1/sensors/0');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ tC: 48.3 });
  });

  it('a szenzorhiba kapcsolója hibát állít be', async () => {
    const element = await render();
    const toggle = element.querySelector<HTMLInputElement>('input[role=switch]')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(http.expectOne('/api/devices/d1/sensors/0').request.body).toEqual({ error: 'read' });
  });
});
