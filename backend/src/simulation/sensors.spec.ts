import {
  isValidDs18b20Address,
  randomDs18b20Address,
  resizeSensors,
} from './sensors.js';

describe('DS18B20 címek', () => {
  it('a generált cím családkódja és CRC-je érvényes', () => {
    for (let i = 0; i < 20; i++) {
      const address = randomDs18b20Address();
      expect(address).toMatch(/^28[0-9A-F]{14}$/);
      expect(isValidDs18b20Address(address)).toBe(true);
    }
  });

  it('elutasítja a hibás CRC-t', () => {
    // Egy valós szonda ROM-kódja (28 FF 64 06 C7 CC 95 B1) egy bájtja elrontva.
    const address = randomDs18b20Address();
    const broken =
      address.slice(0, 2) + (address[2] === '0' ? '1' : '0') + address.slice(3);
    expect(isValidDs18b20Address(broken)).toBe(false);
  });
});

describe('resizeSensors', () => {
  it('megtartja a meglévő hőmérők címét és értékét', () => {
    const first = resizeSensors([], 2);
    first[1].tC = 48;
    const grown = resizeSensors(first, 3);
    expect(grown.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(grown[1]).toEqual(first[1]);
    expect(grown[2].tC).toBe(21.5);
    expect(resizeSensors(grown, 1)).toEqual([first[0]]);
  });
});
