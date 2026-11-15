import {
  type ComposeOptions,
  DEFAULT_COMPOSE_OPTIONS,
  HOMEASSISTANT_CONFIG_PATH,
} from '@iot-sim/shared';
import { parse } from 'yaml';
import { buildHomeAssistantCompose } from './ha-compose.js';

interface Compose {
  services: Record<string, Record<string, unknown>>;
  configs: Record<string, { content: string }>;
  volumes?: unknown;
}

const now = new Date('2026-11-14T20:00:00Z');

function build(overrides: Partial<ComposeOptions> = {}) {
  const result = buildHomeAssistantCompose({
    timeZone: 'Europe/Budapest',
    now,
    options: { ...DEFAULT_COMPOSE_OPTIONS, ...overrides },
  });
  return { ...result, doc: parse(result.compose) as Compose };
}

/** A Compose a `$$`-t `$`-ra cseréli: ezt látja a konténer. */
const unescape = (value: string) => value.replaceAll('$$', '$');

const auth = { username: 'iot', password: 'p@ss $ecret "x"' };

describe('buildHomeAssistantCompose', () => {
  it('alapbeállítás: setup, Mosquitto és Home Assistant, felülírható portokkal', () => {
    const { doc, warnings } = build();
    expect(Object.keys(doc.services)).toEqual([
      'setup',
      'mosquitto-setup',
      'mosquitto',
      'homeassistant',
    ]);
    expect(doc.services.mosquitto).toMatchObject({
      image: 'eclipse-mosquitto:2',
      ports: ['${MQTT_PORT:-1883}:1883'],
      depends_on: {
        'mosquitto-setup': { condition: 'service_completed_successfully' },
      },
      volumes: [
        './mosquitto/config:/mosquitto/config',
        './mosquitto/data:/mosquitto/data',
      ],
    });
    expect(doc.services.homeassistant).toMatchObject({
      image: 'ghcr.io/home-assistant/home-assistant:stable',
      ports: ['${HA_PORT:-8123}:8123'],
      environment: { TZ: '${TZ:-Europe/Budapest}' },
      depends_on: {
        setup: { condition: 'service_completed_successfully' },
        mosquitto: { condition: 'service_started' },
      },
      volumes: ['./homeassistant:/config'],
    });
    expect(doc.services.homeassistant).not.toHaveProperty('extra_hosts');
    expect(doc.volumes).toBeUndefined();
    expect(doc.configs.mosquitto_conf.content).toContain(
      'allow_anonymous true',
    );
    expect(warnings).toEqual([]);
  });

  it('a setup csak a hiányzó Home Assistant fájlokat hozza létre', () => {
    const { doc, compose } = build();
    const script = (doc.services.setup.command as string[])[0];
    for (const file of [
      'configuration.yaml',
      'automations.yaml',
      'scripts.yaml',
      'scenes.yaml',
    ]) {
      expect(script).toContain(`[ -f /homeassistant/${file} ] ||`);
    }
    expect(compose).toContain(`ide: ${HOMEASSISTANT_CONFIG_PATH}`);
    const tag = (name: string) => ({
      tag: name,
      resolve: (v: string) => `${name}:${v}`,
    });
    expect(
      parse(doc.configs.homeassistant_configuration.content, {
        customTags: [
          tag('!include'),
          tag('!include_dir_named'),
          tag('!include_dir_merge_named'),
        ],
      }),
    ).toEqual({
      default_config: null,
      homeassistant: { packages: '!include_dir_named:packages' },
      frontend: { themes: '!include_dir_merge_named:themes' },
      automation: '!include:automations.yaml',
      script: '!include:scripts.yaml',
      scene: '!include:scenes.yaml',
    });
  });

  it('jelszavas védelem: a jelszó csak környezeti változóban, $ escape-pel, és a broker nem enged névtelent', () => {
    const { doc, compose, warnings } = build({
      mosquitto: { enabled: true, auth },
    });
    const setup = doc.services['mosquitto-setup'];
    expect(setup).toMatchObject({
      image: 'eclipse-mosquitto:2',
      restart: 'no',
    });
    expect(setup.environment).toEqual({
      MQTT_USERNAME: 'iot',
      MQTT_PASSWORD: 'p@ss $$ecret "x"',
    });
    expect(
      unescape((setup.environment as Record<string, string>).MQTT_PASSWORD),
    ).toBe(auth.password);
    const script = unescape((setup.command as string[])[0]);
    expect(script).toContain(
      'mosquitto_passwd -b -c /mosquitto/config/passwd "$MQTT_USERNAME" "$MQTT_PASSWORD"',
    );
    expect(script).toContain('chown -R mosquitto:mosquitto /mosquitto');
    // A jelszó a parancssorban nem szerepel, csak a változóban.
    expect(script).not.toContain('ecret');
    expect(doc.configs.mosquitto_conf.content.split('\n')).toEqual(
      expect.arrayContaining([
        'allow_anonymous false',
        'password_file /mosquitto/config/passwd',
      ]),
    );
    expect(compose).toContain(
      'FIGYELEM: ez a fájl a broker jelszavát olvasható formában tartalmazza',
    );
    expect(warnings).toEqual([
      expect.stringContaining('olvasható formában'),
      expect.stringContaining('„iot” felhasználót'),
    ]);
  });

  it('Mosquitto nélkül a külső brokert használja, és a gépet host.docker.internal néven éri el', () => {
    const { doc, warnings } = build({
      mosquitto: { enabled: false },
      broker: {
        host: 'host.docker.internal',
        port: 18830,
        username: null,
        password: null,
      },
      nodeRed: { enabled: true },
    });
    expect(Object.keys(doc.services)).toEqual([
      'setup',
      'homeassistant',
      'nodered',
    ]);
    expect(doc.configs).not.toHaveProperty('mosquitto_conf');
    expect(doc.services.homeassistant).toMatchObject({
      depends_on: { setup: { condition: 'service_completed_successfully' } },
      extra_hosts: ['host.docker.internal:host-gateway'],
    });
    expect(doc.services.nodered.environment).toMatchObject({
      MQTT_HOST: 'host.docker.internal',
      MQTT_PORT: '18830',
      MQTT_USERNAME: '',
      MQTT_PASSWORD: '',
    });
    expect(warnings).toEqual([
      expect.stringContaining('host.docker.internal:18830'),
    ]);
    expect(() =>
      buildHomeAssistantCompose({
        timeZone: 'UTC',
        options: {
          ...DEFAULT_COMPOSE_OPTIONS,
          mosquitto: { enabled: false },
          broker: null,
        },
      }),
    ).toThrow(/külső broker/);
  });

  it('Node-RED: kezdő folyam a brokerrel, hitelesítés környezeti változóból, mappa az 1000-es felhasználónak', () => {
    const { doc } = build({
      mosquitto: { enabled: true, auth },
      nodeRed: { enabled: true },
    });
    expect(doc.services.nodered).toMatchObject({
      image: 'nodered/node-red:5.0',
      ports: ['${NODERED_PORT:-1880}:1880'],
      volumes: ['./node-red:/data'],
      environment: {
        MQTT_HOST: 'mosquitto',
        MQTT_PORT: '1883',
        MQTT_USERNAME: 'iot',
        MQTT_PASSWORD: 'p@ss $$ecret "x"',
      },
    });
    const script = (doc.services.setup.command as string[])[0];
    expect(script).toContain('[ -f /node-red/flows.json ] ||');
    expect(script).toContain('chown -R 1000:1000 /node-red');

    const flows = JSON.parse(
      unescape(doc.configs.nodered_flows.content),
    ) as Array<Record<string, unknown>>;
    expect(flows.find((n) => n.type === 'mqtt-broker')).toMatchObject({
      broker: '${MQTT_HOST}',
      port: '${MQTT_PORT}',
    });
    expect(flows.find((n) => n.type === 'mqtt in')).toMatchObject({
      topic: '#',
      broker: 'iotsim_broker',
    });
    // A hitelesítő adatok fájljában csak hivatkozás van, a jelszó nem.
    const credentials = unescape(doc.configs.nodered_credentials.content);
    expect(JSON.parse(credentials)).toEqual({
      iotsim_broker: { user: '${MQTT_USERNAME}', password: '${MQTT_PASSWORD}' },
    });
    expect(unescape(doc.configs.nodered_settings.content)).toContain(
      'credentialSecret: false',
    );
  });

  it('a szimulátor a megadott képpel, letöltés nélkül, a compose brokeréhez kapcsolódik', () => {
    const { doc, compose, warnings } = build({
      mosquitto: { enabled: true, auth },
      simulator: {
        enabled: true,
        image: 'registry.local:5000/iot-sim:1.2',
        seedDevices: true,
      },
    });
    expect(doc.services.simulator).toMatchObject({
      image: 'registry.local:5000/iot-sim:1.2',
      pull_policy: 'never',
      ports: ['${SIMULATOR_PORT:-3000}:3000'],
      volumes: ['./simulator:/data'],
      environment: {
        MQTT_URL: 'mqtt://mosquitto:1883',
        MQTT_USERNAME: 'iot',
        MQTT_PASSWORD: 'p@ss $$ecret "x"',
        CONFIG_FILE: '/data/devices.json',
        CONFIG_IMPORT_MODE: 'seed',
      },
    });
    expect(doc.services.simulator).not.toHaveProperty('build');
    const script = (doc.services.setup.command as string[])[0];
    expect(script).toContain('chown -R 1000:1000 /simulator');
    expect(script).toContain('[ -f /simulator/devices.json ] || echo');
    expect(compose).toContain(
      'docker build -t registry.local:5000/iot-sim:1.2 .',
    );
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('nem tölti le'),
        expect.stringContaining('port ütközik'),
        expect.stringContaining('simulator/devices.json'),
      ]),
    );
  });

  it('a szimulátor kezdő eszközlista nélkül nem kap CONFIG_FILE-t, jelszó nélkül MQTT_PASSWORD-öt', () => {
    const { doc } = build({
      simulator: {
        enabled: true,
        image: 'iot-device-simulator:latest',
        seedDevices: false,
      },
    });
    expect(doc.services.simulator.environment).toEqual({
      TZ: '${TZ:-Europe/Budapest}',
      LOG_LEVEL: 'info',
      MQTT_URL: 'mqtt://mosquitto:1883',
    });
  });
});
