import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('megjeleníti a navigációt', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.navbar-brand')?.textContent).toContain('IoT szimulátor');
    const links = Array.from(compiled.querySelectorAll('.nav-link')).map((a) =>
      a.textContent?.trim(),
    );
    expect(links).toEqual(['Eszközök', 'Beállítások']);
  });

  it('a fejlécben mutatja a brokerkapcsolat állapotát', async () => {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/broker').flush({
      host: 'localhost',
      port: 1883,
      tls: false,
      username: null,
      hasPassword: false,
      managedByEnv: false,
      connection: { status: 'connected' },
    });
    await fixture.whenStable();
    const badge = (fixture.nativeElement as HTMLElement).querySelector('.badge');
    expect(badge?.textContent?.trim()).toBe('Broker: csatlakozva');
    expect(badge?.classList).toContain('text-bg-success');
  });
});
