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
    volumes: Record<string, unknown>;
  };

  it('Home Assistant és Mosquitto, felülírható portokkal', () => {
    expect(Object.keys(compose.services)).toEqual([
      'mosquitto',
      'homeassistant',
    ]);
    expect(compose.services.mosquitto).toMatchObject({
      image: 'eclipse-mosquitto:2',
      ports: ['${MQTT_PORT:-1883}:1883'],
    });
    expect(compose.services.homeassistant).toMatchObject({
      image: 'ghcr.io/home-assistant/home-assistant:stable',
      ports: ['${HA_PORT:-8123}:8123'],
      environment: { TZ: '${TZ:-Europe/Budapest}' },
      depends_on: ['mosquitto'],
    });
    expect(Object.keys(compose.volumes)).toEqual([
      'mosquitto-data',
      'homeassistant-config',
    ]);
  });

  it('a generált konfigurációt a megadott útvonalról, csomagként tölti be', () => {
    expect(HOMEASSISTANT_CONFIG_PATH).toBe(
      'homeassistant/packages/iot_simulator.yaml',
    );
    expect(compose.services.homeassistant.volumes).toEqual([
      'homeassistant-config:/config',
      './homeassistant/packages:/config/packages:ro',
    ]);
    const configuration = parse(
      compose.configs.homeassistant_configuration.content,
      {
        customTags: [
          {
            tag: '!include_dir_named',
            resolve: (value: string) => `include:${value}`,
          },
        ],
      },
    ) as Record<string, unknown>;
    expect(configuration).toEqual({
      default_config: null,
      homeassistant: { packages: 'include:packages' },
    });
    // A felhasználónak szóló utasítás megnevezi az útvonalat.
    expect(yaml).toContain(`ide: ${HOMEASSISTANT_CONFIG_PATH}`);
  });

  it('a Mosquitto névtelen kapcsolódást enged az 1883-as porton', () => {
    expect(compose.configs.mosquitto_conf.content.split('\n')).toEqual(
      expect.arrayContaining(['listener 1883', 'allow_anonymous true']),
    );
  });
});
