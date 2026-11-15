import {
  HOMEASSISTANT_CONFIG_PATH,
  HOMEASSISTANT_DATA_DIR,
  MOSQUITTO_DATA_DIR,
} from '@iot-sim/shared';

export interface HaComposeOptions {
  /** A Home Assistant konténer időzónája, ha a TZ környezeti változó nincs megadva. */
  timeZone: string;
  /** A generálás ideje a fejléc-kommenthez. */
  now?: Date;
}

/** Mosquitto 2: névtelen kapcsolódás, mert a szimulátor és a Home Assistant is így csatlakozik. */
const MOSQUITTO_CONF = [
  'listener 1883',
  'allow_anonymous true',
  'persistence true',
  'persistence_location /mosquitto/data/',
];

/**
 * A Home Assistant kezdő configuration.yaml-je: a Home Assistant saját alapértelmezése
 * (a felületen létrehozott automatizálások, szkriptek és jelenetek include-jaival),
 * kiegészítve a csomagokkal, amelyekből a szimulátor entitásai jönnek.
 */
const HA_CONFIGURATION = [
  '# Home Assistant alapbeállítás; szabadon szerkeszthető, a setup nem írja felül.',
  '# A szimulátor entitásai a packages mappából jönnek.',
  'default_config:',
  '',
  'homeassistant:',
  '  packages: !include_dir_named packages',
  '',
  'frontend:',
  '  themes: !include_dir_merge_named themes',
  '',
  'automation: !include automations.yaml',
  'script: !include scripts.yaml',
  'scene: !include scenes.yaml',
];

/**
 * Az első induláskor futó előkészítés: létrehozza a mappákat és a hiányzó kezdő fájlokat.
 * Meglévő fájlt nem ír felül, így a kézi módosítások megmaradnak.
 */
const SETUP_SCRIPT = [
  'set -e',
  'mkdir -p /homeassistant/packages /homeassistant/themes /mosquitto/config /mosquitto/data',
  '[ -f /homeassistant/configuration.yaml ] || cp /seed/configuration.yaml /homeassistant/configuration.yaml',
  '[ -f /homeassistant/automations.yaml ] || echo "[]" > /homeassistant/automations.yaml',
  '[ -f /homeassistant/scripts.yaml ] || touch /homeassistant/scripts.yaml',
  '[ -f /homeassistant/scenes.yaml ] || touch /homeassistant/scenes.yaml',
  '[ -f /mosquitto/config/mosquitto.conf ] || cp /seed/mosquitto.conf /mosquitto/config/mosquitto.conf',
];

/** Beágyazott szöveg blokkszövegként; a Compose a `$` jelet változóként értené. */
function block(lines: readonly string[], indent: number): string {
  const pad = ' '.repeat(indent);
  return lines
    .map((line) => (line ? `${pad}${line.replaceAll('$', '$$$$')}` : ''))
    .join('\n');
}

/**
 * docker-compose.yml egy Home Assistanttel és egy Mosquitto brokerrel. Minden adat a
 * compose melletti mappákba kerül (bind mount): a Home Assistant konfigurációja,
 * `.storage`-a és adatbázisa a `homeassistant/`, a broker konfigurációja és adatai a
 * `mosquitto/` alá. A Home Assistant a generált konfigurációt (HOMEASSISTANT_CONFIG_PATH)
 * csomagként tölti be; a brokerkapcsolatot egyszer a felületen kell felvenni, mert a
 * Home Assistant MQTT-integrációja YAML-ből nem kapja meg a broker címét.
 */
export function buildHomeAssistantCompose(options: HaComposeOptions): string {
  const now = options.now ?? new Date();
  return `# Home Assistant és Mosquitto MQTT-broker az IoT szimulátorhoz.
# Generálva: ${now.toISOString()}. Docker Compose 2.23.1 vagy újabb kell hozzá.
#
# Minden adat ebben a mappában marad, a konténerek újralétrehozása után is:
#   ${HOMEASSISTANT_DATA_DIR}/          a Home Assistant /config mappája: configuration.yaml,
#                            .storage (felhasználók, integrációk), home-assistant_v2.db (előzmények)
#   ${HOMEASSISTANT_CONFIG_PATH}   a szimulátorból generált konfiguráció
#   ${MOSQUITTO_DATA_DIR}/config/       mosquitto.conf
#   ${MOSQUITTO_DATA_DIR}/data/         a broker megőrzött üzenetei
# Az első indításkor a setup szolgáltatás létrehozza a mappákat és a hiányzó kezdő
# fájlokat; meglévő fájlt nem ír felül, így a configuration.yaml szabadon szerkeszthető.
#
# Használat:
#  1. Mentsd ezt a fájlt egy üres mappába docker-compose.yml néven, a generált
#     Home Assistant konfigurációt pedig mellé, ide: ${HOMEASSISTANT_CONFIG_PATH}
#  2. Indítsd el: docker compose up -d
#  3. Nyisd meg a http://localhost:8123 címet, és végezd el a Home Assistant első beállítását.
#  4. Vedd fel az MQTT-integrációt (Beállítások > Eszközök és szolgáltatások >
#     Integráció hozzáadása > MQTT): broker mosquitto, port 1883, felhasználó nélkül.
#     A brokerkapcsolat a Home Assistantben csak a felületen állítható be.
#  5. A szimulátor ehhez a brokerhez kapcsolódjon: mqtt://<a gép címe>:1883
#     (Beállítások oldal vagy MQTT_URL). Ha az 1883-as port foglalt, például a szimulátor
#     saját Mosquittója miatt, indítsd így: MQTT_PORT=1884 docker compose up -d
#
# Ha változik az eszközlista, írd felül a ${HOMEASSISTANT_CONFIG_PATH} fájlt, majd:
#   docker compose restart homeassistant
name: iot-simulator-homeassistant

services:
  setup:
    image: ghcr.io/home-assistant/home-assistant:stable
    restart: 'no'
    entrypoint: ['/bin/sh', '-c']
    command:
      - |
${block(SETUP_SCRIPT, 8)}
    configs:
      - source: homeassistant_configuration
        target: /seed/configuration.yaml
      - source: mosquitto_conf
        target: /seed/mosquitto.conf
    volumes:
      - ./${HOMEASSISTANT_DATA_DIR}:/homeassistant
      - ./${MOSQUITTO_DATA_DIR}:/mosquitto

  mosquitto:
    image: eclipse-mosquitto:2
    restart: unless-stopped
    depends_on:
      setup:
        condition: service_completed_successfully
    ports:
      - '\${MQTT_PORT:-1883}:1883'
    volumes:
      - ./${MOSQUITTO_DATA_DIR}/config:/mosquitto/config
      - ./${MOSQUITTO_DATA_DIR}/data:/mosquitto/data

  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    restart: unless-stopped
    depends_on:
      setup:
        condition: service_completed_successfully
      mosquitto:
        condition: service_started
    ports:
      - '\${HA_PORT:-8123}:8123'
    environment:
      TZ: '\${TZ:-${options.timeZone}}'
    volumes:
      - ./${HOMEASSISTANT_DATA_DIR}:/config

configs:
  mosquitto_conf:
    content: |
${block(MOSQUITTO_CONF, 6)}
  homeassistant_configuration:
    content: |
${block(HA_CONFIGURATION, 6)}
`;
}
