import { HOMEASSISTANT_CONFIG_PATH } from '@iot-sim/shared';
import { parse } from 'yaml';
import { buildHomeAssistantCompose } from './ha-compose.js';

describe('buildHomeAssistantCompose', () => {
  const yaml = buildHomeAssistantCompose({
    timeZone: 'Europe/Budapest',
    now: new Date('2026-11-14T20:00:00Z'),
  });
  const compose = parse(yaml) as {
    services: Record<string, Record<string, unknown>>;
    configs: Record<string, { content: string }>;
    volumes?: unknown;
  };

  it('setup, Mosquitto és Home Assistant, felülírható portokkal', () => {
    expect(Object.keys(compose.services)).toEqual([
      'setup',
      'mosquitto',
      'homeassistant',
    ]);
    expect(compose.services.mosquitto).toMatchObject({
      image: 'eclipse-mosquitto:2',
      ports: ['${MQTT_PORT:-1883}:1883'],
      depends_on: { setup: { condition: 'service_completed_successfully' } },
    });
    expect(compose.services.homeassistant).toMatchObject({
      image: 'ghcr.io/home-assistant/home-assistant:stable',
      ports: ['${HA_PORT:-8123}:8123'],
      environment: { TZ: '${TZ:-Europe/Budapest}' },
      depends_on: {
        setup: { condition: 'service_completed_successfully' },
        mosquitto: { condition: 'service_started' },
      },
    });
  });

  it('minden adat a compose melletti mappákba kerül, nevesített kötet nincs', () => {
    expect(compose.volumes).toBeUndefined();
    expect(compose.services.homeassistant.volumes).toEqual([
      './homeassistant:/config',
    ]);
    expect(compose.services.mosquitto.volumes).toEqual([
      './mosquitto/config:/mosquitto/config',
      './mosquitto/data:/mosquitto/data',
    ]);
    // A generált konfiguráció a /config/packages alá kerül, ahonnan a csomagok töltődnek.
    expect(HOMEASSISTANT_CONFIG_PATH).toBe(
      'homeassistant/packages/iot_simulator.yaml',
    );
    expect(yaml).toContain(`ide: ${HOMEASSISTANT_CONFIG_PATH}`);
  });

  it('a setup csak a hiányzó kezdő fájlokat hozza létre', () => {
    const script = (compose.services.setup.command as string[])[0];
    expect(compose.services.setup).toMatchObject({
      restart: 'no',
      entrypoint: ['/bin/sh', '-c'],
    });
    for (const file of [
      '/homeassistant/configuration.yaml',
      '/homeassistant/automations.yaml',
      '/homeassistant/scripts.yaml',
      '/homeassistant/scenes.yaml',
      '/mosquitto/config/mosquitto.conf',
    ]) {
      expect(script).toContain(`[ -f ${file} ] ||`);
    }
    expect(script).not.toContain('$');
  });

  it('a kezdő configuration.yaml a csomagokat és az alapértelmezett include-okat tölti be', () => {
    const tag = (name: string) => ({
      tag: name,
      resolve: (value: string) => `${name}:${value}`,
    });
    const configuration = parse(
      compose.configs.homeassistant_configuration.content,
      {
        customTags: [
          tag('!include'),
          tag('!include_dir_named'),
          tag('!include_dir_merge_named'),
        ],
      },
    ) as Record<string, unknown>;
    expect(configuration).toEqual({
      default_config: null,
      homeassistant: { packages: '!include_dir_named:packages' },
      frontend: { themes: '!include_dir_merge_named:themes' },
      automation: '!include:automations.yaml',
      script: '!include:scripts.yaml',
      scene: '!include:scenes.yaml',
    });
    expect(compose.configs.mosquitto_conf.content.split('\n')).toEqual(
      expect.arrayContaining(['listener 1883', 'allow_anonymous true']),
    );
  });
});
