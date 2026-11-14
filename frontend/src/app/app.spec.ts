import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
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
});
