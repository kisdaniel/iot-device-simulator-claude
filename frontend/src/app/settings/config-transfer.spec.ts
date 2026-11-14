import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ImportSummary } from '@iot-sim/shared';
import { ConfigTransfer } from './config-transfer';

const summary = (overrides: Partial<ImportSummary> = {}): ImportSummary => ({
  mode: 'replace',
  applied: false,
  skipped: false,
  created: [{ name: 'Szárító', type: 'tasmota', identity: 'szarito' }],
  updated: [],
  unchanged: [],
  removed: [{ name: 'Mosógép', type: 'tasmota', identity: 'mosogep' }],
  broker: 'absent',
  ...overrides,
});

describe('ConfigTransfer', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ConfigTransfer],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function choose(element: HTMLElement, content: string): Promise<void> {
    const input = element.querySelector<HTMLInputElement>('#configFile')!;
    const file = new File([content], 'devices.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('az export címe követi az állapot kapcsolót', async () => {
    const fixture = TestBed.createComponent(ConfigTransfer);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const link = () =>
      element.querySelector<HTMLAnchorElement>('a[download]')!.getAttribute('href');
    expect(link()).toBe('/api/config/export?includeState=true');
    element.querySelector<HTMLInputElement>('#includeState')!.click();
    await fixture.whenStable();
    expect(link()).toBe('/api/config/export?includeState=false');
  });

  it('a fájl kiválasztása után előnézetet kér, és csak a gombra importál', async () => {
    const fixture = TestBed.createComponent(ConfigTransfer);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLInputElement>('#modeReplace')!.click();
    await choose(element, '{"version":1,"devices":[]}');

    const dry = http.expectOne((r) => r.url === '/api/config/import');
    expect(dry.request.params.get('mode')).toBe('replace');
    expect(dry.request.params.get('dryRun')).toBe('true');
    expect(dry.request.body).toEqual({ version: 1, devices: [] });
    dry.flush(summary());
    await fixture.whenStable();

    const preview = element.querySelector('[data-testid="import-preview"]')!.textContent!;
    expect(preview).toContain('Létrejön (1)');
    expect(preview).toContain('Szárító');
    expect(preview).toContain('Törlődik (1)');
    const button = element.querySelector<HTMLButtonElement>(
      '[data-testid="import-preview"] button',
    )!;
    expect(button.textContent).toContain('1 eszköz törlődik');
    expect(button.classList).toContain('btn-danger');

    button.click();
    const real = http.expectOne((r) => r.url === '/api/config/import');
    expect(real.request.params.get('dryRun')).toBe('false');
    real.flush(summary({ applied: true }));
    await fixture.whenStable();
    expect(element.querySelector('[data-testid="import-result"]')!.textContent).toContain(
      '1 új, 0 frissített, 1 törölt',
    );
    expect(element.querySelector('[data-testid="import-preview"]')).toBeNull();
    http.verify();
  });

  it('hibás fájlnál a mezőszintű hibákat mutatja, érvénytelen JSON-nál kérés sincs', async () => {
    const fixture = TestBed.createComponent(ConfigTransfer);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    await choose(element, '{ nem json');
    await fixture.whenStable();
    http.expectNone('/api/config/import');
    expect(element.querySelector('[data-testid="import-errors"]')!.textContent).toContain(
      'nem érvényes JSON',
    );

    await choose(element, '{"version":1,"devices":[{}]}');
    http
      .expectOne((r) => r.url === '/api/config/import')
      .flush(
        {
          message: 'A konfigurációs fájl hibás; semmi nem változott.',
          errors: [{ path: 'devices[0].name', device: 'X', message: 'a név kötelező' }],
        },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    const errors = element.querySelector('[data-testid="import-errors"]')!.textContent!;
    expect(errors).toContain('semmi nem változott');
    expect(errors).toContain('devices[0].name');
    expect(errors).toContain('a név kötelező');
    expect(element.querySelector('[data-testid="import-preview"]')).toBeNull();
  });
});
