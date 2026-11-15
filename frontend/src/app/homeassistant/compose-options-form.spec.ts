import { DEFAULT_COMPOSE_OPTIONS } from '@iot-sim/shared';
import { brokerPrefill, composeFormResult, INITIAL_COMPOSE_FORM } from './compose-options-form';

describe('composeFormResult', () => {
  it('az alap űrlap az alapbeállítást adja', () => {
    expect(composeFormResult(INITIAL_COMPOSE_FORM)).toEqual({
      options: DEFAULT_COMPOSE_OPTIONS,
      errors: {},
    });
  });

  it('jelszavas védelemnél kötelező a felhasználó és a jelszó, és ellenőrzi a formájukat', () => {
    const state = { ...INITIAL_COMPOSE_FORM, auth: true };
    expect(composeFormResult(state).errors).toEqual({
      authUsername: 'A felhasználónév kötelező.',
      authPassword: 'A jelszó kötelező.',
    });
    expect(
      composeFormResult({ ...state, authUsername: 'a:b', authPassword: 'x\ny' }).errors,
    ).toEqual({
      authUsername: 'Legfeljebb 64 karakter, szóköz és kettőspont nélkül.',
      authPassword: 'Legfeljebb 128 karakter, sortörés nélkül.',
    });
    expect(
      composeFormResult({ ...state, authUsername: ' iot ', authPassword: 'p@ss $x' }).options
        ?.mosquitto,
    ).toEqual({ enabled: true, auth: { username: 'iot', password: 'p@ss $x' } });
  });

  it('Mosquitto nélkül külső broker kell, a jelszavas mezők nem számítanak', () => {
    const state = { ...INITIAL_COMPOSE_FORM, mosquitto: false, auth: true, brokerPort: null };
    expect(composeFormResult(state).errors).toEqual({
      brokerHost: 'A broker címe kötelező.',
      brokerPort: 'A port 1 és 65535 közötti egész szám.',
    });
    expect(
      composeFormResult({ ...state, brokerHost: 'host.docker.internal', brokerPort: 1884 }).options,
    ).toMatchObject({
      mosquitto: { enabled: false, auth: null },
      broker: { host: 'host.docker.internal', port: 1884, username: null, password: null },
    });
  });

  it('a szimulátor képneve ellenőrzött; a kezdő eszközlista csak bekapcsolt szimulátornál él', () => {
    expect(
      composeFormResult({ ...INITIAL_COMPOSE_FORM, simulator: true, simulatorImage: 'rossz kép' })
        .errors,
    ).toEqual({ simulatorImage: 'Érvényes képnév kell, pl. iot-device-simulator:latest.' });
    expect(
      composeFormResult({ ...INITIAL_COMPOSE_FORM, simulator: false, seedDevices: true }).options
        ?.simulator.seedDevices,
    ).toBe(false);
  });

  it('a helyi brokercímet host.docker.internal-ra cseréli az előtöltésnél', () => {
    const view = {
      host: 'localhost',
      port: 1883,
      tls: false,
      username: 'u',
      hasPassword: true,
      managedByEnv: false,
      connection: { status: 'connected' as const },
    };
    expect(brokerPrefill(view)).toEqual({
      brokerHost: 'host.docker.internal',
      brokerPort: 1883,
      brokerUsername: 'u',
    });
    expect(brokerPrefill({ ...view, host: 'mosquitto', username: null }).brokerHost).toBe(
      'mosquitto',
    );
  });
});
