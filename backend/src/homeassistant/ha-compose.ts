import {
  HOMEASSISTANT_CONFIG_PATH,
  HOMEASSISTANT_PACKAGES_DIR,
} from '@iot-sim/shared';

export interface HaComposeOptions {
  /** A Home Assistant konténer időzónája, ha a TZ környezeti változó nincs megadva. */
  timeZone: string;
  /** A generálás ideje a fejléc-kommenthez. */
  now?: Date;
}

/** A Home Assistant csomagkönyvtára a konténerben. */
const CONTAINER_PACKAGES_DIR = '/config/packages';

/** Mosquitto 2: névtelen kapcsolódás, mert a szimulátor és a Home Assistant is így csatlakozik. */
const MOSQUITTO_CONF = [
  'listener 1883',
  'allow_anonymous true',
  'persistence true',
  'persistence_location /mosquitto/data/',
];

/**
 * A Home Assistant alapbeállítása. A szimulátor entitásai csomagként jönnek, így a
 * generált fájl változatlanul (a saját `mqtt:` kulcsával) betölthető.
 */
const HA_CONFIGURATION = [
  '# A szimulátor entitásai a packages mappából jönnek.',
  'default_config:',
  'homeassistant:',
  '  packages: !include_dir_named packages',
];

/** Beágyazott fájltartalom blokkszövegként; a Compose a `$` jelet változóként értené. */
function content(lines: readonly string[]): string {
  return lines
    .map((line) => `      ${line.replaceAll('$', '$$$$')}`)
    .join('\n');
}

/**
 * docker-compose.yml egy Home Assistanttel és egy Mosquitto brokerrel. A Home Assistant
 * a mellé mentett generált konfigurációt (HOMEASSISTANT_CONFIG_PATH) csomagként tölti be;
 * a brokerkapcsolatot egyszer a felületen kell felvenni, mert a Home Assistant MQTT-
 * integrációja YAML-ből nem kapja meg a broker címét.
 */
export function buildHomeAssistantCompose(options: HaComposeOptions): string {
  const now = options.now ?? new Date();
  return `# Home Assistant és Mosquitto MQTT-broker az IoT szimulátorhoz.
# Generálva: ${now.toISOString()}. Docker Compose 2.23.1 vagy újabb kell hozzá.
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
  mosquitto:
    image: eclipse-mosquitto:2
    restart: unless-stopped
    ports:
      - '\${MQTT_PORT:-1883}:1883'
    configs:
      - source: mosquitto_conf
        target: /mosquitto/config/mosquitto.conf
    volumes:
      - mosquitto-data:/mosquitto/data

  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    restart: unless-stopped
    depends_on:
      - mosquitto
    ports:
      - '\${HA_PORT:-8123}:8123'
    environment:
      TZ: '\${TZ:-${options.timeZone}}'
    configs:
      - source: homeassistant_configuration
        target: /config/configuration.yaml
    volumes:
      - homeassistant-config:/config
      - ./${HOMEASSISTANT_PACKAGES_DIR}:${CONTAINER_PACKAGES_DIR}:ro

configs:
  mosquitto_conf:
    content: |
${content(MOSQUITTO_CONF)}
  homeassistant_configuration:
    content: |
${content(HA_CONFIGURATION)}

volumes:
  mosquitto-data:
  homeassistant-config:
`;
}
