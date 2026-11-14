import { EnvValidationError, loadConfig } from './env.js';

describe('loadConfig', () => {
  it('alapértékeket ad üres környezetre', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      port: 3000,
      dataDir: './data',
      mqtt: null,
      configImportMode: 'seed',
      logLevel: 'info',
      messageLogSize: 200,
      mqttRejectUnauthorized: true,
    });
  });

  it('a MQTT_URL-ből kiolvassa a hosztot, a portot és a TLS-t', () => {
    expect(loadConfig({ MQTT_URL: 'mqtt://mosquitto:1883' }).mqtt).toEqual({
      host: 'mosquitto',
      port: 1883,
      tls: false,
      username: null,
      password: null,
    });
    expect(
      loadConfig({ MQTT_URL: 'mqtts://broker.example' }).mqtt,
    ).toMatchObject({
      host: 'broker.example',
      port: 8883,
      tls: true,
    });
  });

  it('a külön megadott felhasználó és jelszó érvényes', () => {
    const config = loadConfig({
      MQTT_URL: 'mqtt://localhost',
      MQTT_USERNAME: 'sim',
      MQTT_PASSWORD: 'titok',
    });
    expect(config.mqtt).toMatchObject({ username: 'sim', password: 'titok' });
  });

  it('minden hibát egyszerre jelez', () => {
    const load = () =>
      loadConfig({
        PORT: 'abc',
        MQTT_URL: 'http://x',
        CONFIG_IMPORT_MODE: 'overwrite',
      });
    expect(load).toThrow(EnvValidationError);
    try {
      load();
    } catch (err) {
      expect((err as EnvValidationError).problems).toHaveLength(3);
    }
  });
});
