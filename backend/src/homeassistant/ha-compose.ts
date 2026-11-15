import {
  type ComposeOptions,
  DEFAULT_COMPOSE_OPTIONS,
  HOMEASSISTANT_CONFIG_PATH,
  HOMEASSISTANT_DATA_DIR,
  type HomeAssistantComposeResult,
  MOSQUITTO_DATA_DIR,
  NODERED_DATA_DIR,
  SIMULATOR_DATA_DIR,
  SIMULATOR_SEED_PATH,
} from '@iot-sim/shared';
import { stringify } from 'yaml';

export interface HaComposeOptions {
  /** A konténerek időzónája, ha a TZ környezeti változó nincs megadva. */
  timeZone: string;
  /** A compose tartalma; alapból DEFAULT_COMPOSE_OPTIONS. */
  options?: ComposeOptions;
  /** A generálás ideje a fejléc-kommenthez. */
  now?: Date;
}

const HOMEASSISTANT_IMAGE = 'ghcr.io/home-assistant/home-assistant:stable';
const MOSQUITTO_IMAGE = 'eclipse-mosquitto:2';
/** Rögzített főverzió; a Node-RED 5 csak `5.0` alakú címkét ad. */
const NODERED_IMAGE = 'nodered/node-red:5.0';
/** A Node-RED és a szimulátor képe ezzel a felhasználóval fut. */
const CONTAINER_UID = '1000:1000';
/** A külső broker és a gépen futó szolgáltatások elérése a konténerekből. */
const HOST_GATEWAY = ['host.docker.internal:host-gateway'];

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
  '',
].join('\n');

/**
 * A Node-RED kezdő beállítása. A hitelesítő adatok titkosítatlanul tárolódnak, de csak
 * `${MQTT_USERNAME}` és `${MQTT_PASSWORD}` hivatkozást tartalmaznak: a valódi értékek a
 * compose környezeti változóiból jönnek (Node-RED 5-tel ellenőrizve; titkosított
 * tárolásnál a Node-RED a hivatkozásos fájlt nem fogadja el).
 */
const NODERED_SETTINGS = [
  '// A szimulátor compose-a hozta létre; szabadon szerkeszthető, a setup nem írja felül.',
  '// A flows_cred.json csak ${MQTT_USERNAME} és ${MQTT_PASSWORD} hivatkozást tartalmaz,',
  '// a valódi értékek a docker-compose.yml környezeti változóiból jönnek.',
  'module.exports = {',
  "  flowFile: 'flows.json',",
  '  credentialSecret: false,',
  '  uiPort: process.env.PORT || 1880,',
  '};',
  '',
].join('\n');

/** Egy broker-konfigurációs csomópont és egy példafolyam: minden üzenet a hibakeresési panelre. */
const NODERED_FLOWS = `${JSON.stringify(
  [
    { id: 'iotsim_tab', type: 'tab', label: 'IoT szimulátor' },
    {
      id: 'iotsim_broker',
      type: 'mqtt-broker',
      name: 'IoT szimulátor broker',
      broker: '${MQTT_HOST}',
      port: '${MQTT_PORT}',
      clientid: '',
      autoConnect: true,
      usetls: false,
      protocolVersion: '4',
      keepalive: '60',
      cleansession: true,
    },
    {
      id: 'iotsim_in',
      type: 'mqtt in',
      z: 'iotsim_tab',
      name: 'Minden üzenet',
      topic: '#',
      qos: '0',
      datatype: 'auto-detect',
      broker: 'iotsim_broker',
      nl: false,
      rap: true,
      rh: 0,
      inputs: 0,
      x: 160,
      y: 80,
      wires: [['iotsim_debug']],
    },
    {
      id: 'iotsim_debug',
      type: 'debug',
      z: 'iotsim_tab',
      name: 'Szimulátor üzenetei',
      active: true,
      tosidebar: true,
      console: false,
      complete: 'true',
      targetType: 'full',
      x: 380,
      y: 80,
      wires: [],
    },
  ],
  null,
  2,
)}\n`;

const NODERED_CREDENTIALS = `${JSON.stringify(
  {
    iotsim_broker: { user: '${MQTT_USERNAME}', password: '${MQTT_PASSWORD}' },
  },
  null,
  2,
)}\n`;

/**
 * Szöveg a Compose számára: a `$` jelet a Compose változóként értené, ezért `$$` lesz
 * belőle. Minden nem a Compose-nak szánt szövegre (jelszó, szkript, beágyazott fájl) kell.
 */
function literal(value: string): string {
  return value.replaceAll('$', '$$$$');
}

/** A kliensek (Home Assistant integráció, Node-RED, szimulátor) által használt broker. */
interface ClientBroker {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  external: boolean;
}

function clientBroker(options: ComposeOptions): ClientBroker {
  if (options.mosquitto.enabled) {
    const auth = options.mosquitto.auth;
    return {
      host: 'mosquitto',
      port: 1883,
      username: auth?.username ?? null,
      password: auth?.password ?? null,
      external: false,
    };
  }
  const broker = options.broker;
  if (!broker) {
    throw new Error(
      'Generált Mosquitto nélkül a külső broker megadása kötelező.',
    );
  }
  return {
    host: broker.host,
    port: broker.port,
    username: broker.username || null,
    password: broker.password || null,
    external: true,
  };
}

/**
 * docker-compose.yml a megadott beállításokkal: Home Assistant mindig, Mosquitto
 * (opcionálisan jelszavas védelemmel), Node-RED és maga a szimulátor választhatóan.
 * Minden adat a compose melletti mappákba kerül. A Home Assistant a generált
 * konfigurációt (HOMEASSISTANT_CONFIG_PATH) csomagként tölti be; a brokerkapcsolatot
 * egyszer a felületén kell felvenni, mert az MQTT-integráció YAML-ből nem kapja meg.
 */
export function buildHomeAssistantCompose(
  input: HaComposeOptions,
): HomeAssistantComposeResult {
  const options = input.options ?? DEFAULT_COMPOSE_OPTIONS;
  const now = input.now ?? new Date();
  const broker = clientBroker(options);
  const tz = `\${TZ:-${input.timeZone}}`;
  const brokerEnv = {
    MQTT_HOST: literal(broker.host),
    MQTT_PORT: String(broker.port),
    MQTT_USERNAME: literal(broker.username ?? ''),
    MQTT_PASSWORD: literal(broker.password ?? ''),
  };
  const brokerDependency = options.mosquitto.enabled
    ? { mosquitto: { condition: 'service_started' } }
    : {};
  const external = broker.external ? { extra_hosts: HOST_GATEWAY } : {};

  const services: Record<string, unknown> = {
    setup: setupService(options),
  };
  if (options.mosquitto.enabled) {
    services['mosquitto-setup'] = mosquittoSetupService(options);
    services.mosquitto = {
      image: MOSQUITTO_IMAGE,
      restart: 'unless-stopped',
      depends_on: {
        'mosquitto-setup': { condition: 'service_completed_successfully' },
      },
      ports: ['${MQTT_PORT:-1883}:1883'],
      volumes: [
        `./${MOSQUITTO_DATA_DIR}/config:/mosquitto/config`,
        `./${MOSQUITTO_DATA_DIR}/data:/mosquitto/data`,
      ],
    };
  }
  services.homeassistant = {
    image: HOMEASSISTANT_IMAGE,
    restart: 'unless-stopped',
    depends_on: {
      setup: { condition: 'service_completed_successfully' },
      ...brokerDependency,
    },
    ports: ['${HA_PORT:-8123}:8123'],
    environment: { TZ: tz },
    ...external,
    volumes: [`./${HOMEASSISTANT_DATA_DIR}:/config`],
  };
  if (options.nodeRed.enabled) {
    services.nodered = {
      image: NODERED_IMAGE,
      restart: 'unless-stopped',
      depends_on: {
        setup: { condition: 'service_completed_successfully' },
        ...brokerDependency,
      },
      ports: ['${NODERED_PORT:-1880}:1880'],
      environment: { TZ: tz, ...brokerEnv },
      ...external,
      volumes: [`./${NODERED_DATA_DIR}:/data`],
    };
  }
  if (options.simulator.enabled) {
    services.simulator = simulatorService(
      options,
      broker,
      tz,
      brokerDependency,
    );
  }

  const configs: Record<string, { content: string }> = {
    homeassistant_configuration: { content: literal(HA_CONFIGURATION) },
  };
  if (options.mosquitto.enabled) {
    configs.mosquitto_conf = { content: literal(mosquittoConf(options)) };
  }
  if (options.nodeRed.enabled) {
    configs.nodered_settings = { content: literal(NODERED_SETTINGS) };
    configs.nodered_flows = { content: literal(NODERED_FLOWS) };
    configs.nodered_credentials = { content: literal(NODERED_CREDENTIALS) };
  }

  const body = stringify(
    { name: 'iot-simulator-homeassistant', services, configs },
    { lineWidth: 0, aliasDuplicateObjects: false },
  );
  return {
    compose: `${header(options, broker, now)}\n${body}`,
    warnings: warnings(options, broker),
  };
}

/**
 * Az első lépés: mappák és a hiányzó kezdő fájlok. Meglévő fájlt nem ír felül; a
 * Node-RED és a szimulátor mappáját a konténereik felhasználójának adja.
 */
function setupService(options: ComposeOptions): Record<string, unknown> {
  const script = [
    'set -e',
    'mkdir -p /homeassistant/packages /homeassistant/themes',
    '[ -f /homeassistant/configuration.yaml ] || cp /seed/configuration.yaml /homeassistant/configuration.yaml',
    '[ -f /homeassistant/automations.yaml ] || echo "[]" > /homeassistant/automations.yaml',
    '[ -f /homeassistant/scripts.yaml ] || touch /homeassistant/scripts.yaml',
    '[ -f /homeassistant/scenes.yaml ] || touch /homeassistant/scenes.yaml',
  ];
  const configs = [
    {
      source: 'homeassistant_configuration',
      target: '/seed/configuration.yaml',
    },
  ];
  const volumes = [`./${HOMEASSISTANT_DATA_DIR}:/homeassistant`];
  if (options.nodeRed.enabled) {
    script.push(
      'mkdir -p /node-red',
      '[ -f /node-red/settings.js ] || cp /seed/node-red/settings.js /node-red/settings.js',
      '[ -f /node-red/flows.json ] || cp /seed/node-red/flows.json /node-red/flows.json',
      '[ -f /node-red/flows_cred.json ] || cp /seed/node-red/flows_cred.json /node-red/flows_cred.json',
      `chown -R ${CONTAINER_UID} /node-red`,
    );
    configs.push(
      { source: 'nodered_settings', target: '/seed/node-red/settings.js' },
      { source: 'nodered_flows', target: '/seed/node-red/flows.json' },
      {
        source: 'nodered_credentials',
        target: '/seed/node-red/flows_cred.json',
      },
    );
    volumes.push(`./${NODERED_DATA_DIR}:/node-red`);
  }
  if (options.simulator.enabled) {
    script.push('mkdir -p /simulator', `chown -R ${CONTAINER_UID} /simulator`);
    if (options.simulator.seedDevices) {
      script.push(
        // Csak figyelmeztet: a hiányzó fájl a szimulátort állítja meg, a többi szolgáltatást nem.
        `[ -f /simulator/devices.json ] || echo "Figyelem: hiányzik a ${SIMULATOR_SEED_PATH}; a szimulátor enélkül nem indul el." >&2`,
      );
    }
    volumes.push(`./${SIMULATOR_DATA_DIR}:/simulator`);
  }
  return {
    image: HOMEASSISTANT_IMAGE,
    restart: 'no',
    entrypoint: ['/bin/sh', '-c'],
    command: [literal(`${script.join('\n')}\n`)],
    configs,
    volumes,
  };
}

/**
 * A broker előkészítése a Mosquitto képével (abban van `mosquitto_passwd`). A
 * konfiguráció és a jelszófájl a compose beállításait követi, ezért minden indításkor
 * újraíródik; a jelszó környezeti változóból jön, nem a parancssorból.
 */
function mosquittoSetupService(
  options: ComposeOptions,
): Record<string, unknown> {
  const auth = options.mosquitto.auth;
  const script = [
    'set -e',
    'mkdir -p /mosquitto/config /mosquitto/data',
    'cp /seed/mosquitto.conf /mosquitto/config/mosquitto.conf',
    ...(auth
      ? [
          'mosquitto_passwd -b -c /mosquitto/config/passwd "$MQTT_USERNAME" "$MQTT_PASSWORD"',
          'chmod 0700 /mosquitto/config/passwd',
        ]
      : ['rm -f /mosquitto/config/passwd']),
    'chown -R mosquitto:mosquitto /mosquitto',
  ];
  return {
    image: MOSQUITTO_IMAGE,
    restart: 'no',
    entrypoint: ['/bin/sh', '-c'],
    command: [literal(`${script.join('\n')}\n`)],
    ...(auth
      ? {
          environment: {
            MQTT_USERNAME: literal(auth.username),
            MQTT_PASSWORD: literal(auth.password),
          },
        }
      : {}),
    configs: [{ source: 'mosquitto_conf', target: '/seed/mosquitto.conf' }],
    volumes: [`./${MOSQUITTO_DATA_DIR}:/mosquitto`],
  };
}

function mosquittoConf(options: ComposeOptions): string {
  const auth = options.mosquitto.auth
    ? ['allow_anonymous false', 'password_file /mosquitto/config/passwd']
    : ['allow_anonymous true'];
  return [
    '# A docker-compose.yml beállításai szerint; minden indításkor újraíródik.',
    'listener 1883',
    ...auth,
    'persistence true',
    'persistence_location /mosquitto/data/',
    '',
  ].join('\n');
}

function simulatorService(
  options: ComposeOptions,
  broker: ClientBroker,
  tz: string,
  brokerDependency: Record<string, unknown>,
): Record<string, unknown> {
  const environment: Record<string, string> = {
    TZ: tz,
    LOG_LEVEL: 'info',
    MQTT_URL: literal(`mqtt://${broker.host}:${broker.port}`),
  };
  if (broker.username) environment.MQTT_USERNAME = literal(broker.username);
  if (broker.password) environment.MQTT_PASSWORD = literal(broker.password);
  if (options.simulator.seedDevices) {
    environment.CONFIG_FILE = '/data/devices.json';
    environment.CONFIG_IMPORT_MODE = 'seed';
  }
  return {
    image: literal(options.simulator.image),
    pull_policy: 'never',
    restart: 'unless-stopped',
    depends_on: {
      setup: { condition: 'service_completed_successfully' },
      ...brokerDependency,
    },
    ports: ['${SIMULATOR_PORT:-3000}:3000'],
    environment,
    ...(broker.external ? { extra_hosts: HOST_GATEWAY } : {}),
    volumes: [`./${SIMULATOR_DATA_DIR}:/data`],
  };
}

function header(
  options: ComposeOptions,
  broker: ClientBroker,
  now: Date,
): string {
  const names = [
    'Home Assistant',
    ...(options.mosquitto.enabled ? ['Mosquitto MQTT-broker'] : []),
    ...(options.nodeRed.enabled ? ['Node-RED'] : []),
    ...(options.simulator.enabled ? ['maga a szimulátor'] : []),
  ];
  const list =
    names.length > 1
      ? `${names.slice(0, -1).join(', ')} és ${names.at(-1)}`
      : names[0];
  const folders = [
    `#   ${HOMEASSISTANT_DATA_DIR}/          a Home Assistant /config mappája: configuration.yaml,`,
    '#                            .storage (felhasználók, integrációk), home-assistant_v2.db (előzmények)',
    `#   ${HOMEASSISTANT_CONFIG_PATH}   a szimulátorból generált konfiguráció`,
    ...(options.mosquitto.enabled
      ? [
          `#   ${MOSQUITTO_DATA_DIR}/config/       mosquitto.conf${options.mosquitto.auth ? ' és passwd' : ''} (minden indításkor újraíródik)`,
          `#   ${MOSQUITTO_DATA_DIR}/data/         a broker megőrzött üzenetei`,
        ]
      : []),
    ...(options.nodeRed.enabled
      ? [
          `#   ${NODERED_DATA_DIR}/               a Node-RED folyamai és beállításai`,
        ]
      : []),
    ...(options.simulator.enabled
      ? [
          `#   ${SIMULATOR_DATA_DIR}/              a szimulátor adatbázisa${options.simulator.seedDevices ? `; ide: ${SIMULATOR_SEED_PATH} a kezdő eszközlista` : ''}`,
        ]
      : []),
  ];
  const integration = broker.username
    ? `broker ${broker.host}, port ${broker.port}, felhasználó ${broker.username} (a jelszó ebben a fájlban)`
    : `broker ${broker.host}, port ${broker.port}, felhasználó nélkül`;
  const steps = [
    `#  1. Mentsd ezt a fájlt egy üres mappába docker-compose.yml néven, a generált`,
    `#     Home Assistant konfigurációt pedig mellé, ide: ${HOMEASSISTANT_CONFIG_PATH}`,
    ...(options.simulator.enabled && options.simulator.seedDevices
      ? [
          `#     A szimulátor exportját (Beállítások > Exportálás) ide: ${SIMULATOR_SEED_PATH}`,
        ]
      : []),
    ...(options.simulator.enabled
      ? [
          `#     A szimulátor képének (${options.simulator.image}) a gépen kell lennie; a szimulátor`,
          `#     forrásmappájában: docker build -t ${options.simulator.image} .`,
        ]
      : []),
    '#  2. Indítsd el: docker compose up -d',
    '#  3. Nyisd meg a http://localhost:8123 címet, és végezd el a Home Assistant első beállítását.',
    '#  4. Vedd fel az MQTT-integrációt (Beállítások > Eszközök és szolgáltatások >',
    `#     Integráció hozzáadása > MQTT): ${integration}.`,
    '#     A brokerkapcsolat a Home Assistantben csak a felületen állítható be.',
    ...(options.simulator.enabled
      ? [
          '#  5. A szimulátor felülete: http://localhost:3000; a compose brokeréhez magától kapcsolódik.',
        ]
      : [
          `#  5. A szimulátor ehhez a brokerhez kapcsolódjon: mqtt://<a gép címe>:${options.mosquitto.enabled ? '1883' : broker.port}`,
          `#     (Beállítások oldal vagy MQTT_URL)${broker.username ? `, a(z) ${broker.username} felhasználóval` : ''}.`,
        ]),
    ...(options.nodeRed.enabled
      ? [
          '#  6. A Node-RED felülete: http://localhost:1880; a brokerhez előre be van állítva.',
        ]
      : []),
  ];
  const ports = [
    ...(options.mosquitto.enabled ? ['MQTT_PORT (1883)'] : []),
    'HA_PORT (8123)',
    ...(options.nodeRed.enabled ? ['NODERED_PORT (1880)'] : []),
    ...(options.simulator.enabled ? ['SIMULATOR_PORT (3000)'] : []),
  ];
  return [
    `# Docker Compose az IoT szimulátorhoz: ${list}.`,
    `# Generálva: ${now.toISOString()}. Docker Compose 2.23.1 vagy újabb kell hozzá.`,
    ...(broker.password
      ? [
          '#',
          '# FIGYELEM: ez a fájl a broker jelszavát olvasható formában tartalmazza; kezeld bizalmasan.',
        ]
      : []),
    '#',
    '# Minden adat ebben a mappában marad, a konténerek újralétrehozása után is:',
    ...folders,
    '# Az első indításkor a setup lépés létrehozza a mappákat és a hiányzó kezdő fájlokat;',
    '# a Home Assistant és a Node-RED meglévő fájljait nem írja felül.',
    '#',
    '# Használat:',
    ...steps,
    '#',
    `# Foglalt port esetén felülírható: ${ports.join(', ')}, pl. MQTT_PORT=1884 docker compose up -d`,
    '#',
    `# Ha változik az eszközlista, írd felül a ${HOMEASSISTANT_CONFIG_PATH} fájlt, majd:`,
    '#   docker compose restart homeassistant',
  ].join('\n');
}

function warnings(options: ComposeOptions, broker: ClientBroker): string[] {
  const result: string[] = [];
  if (broker.password) {
    result.push(
      'A docker-compose.yml a broker jelszavát olvasható formában tartalmazza; kezeld bizalmasan, és ne tedd verziókezelőbe.',
    );
  }
  if (options.mosquitto.enabled && options.mosquitto.auth) {
    result.push(
      `A broker csak a(z) „${options.mosquitto.auth.username}” felhasználót engedi be: a Home Assistant MQTT-integrációjában${options.simulator.enabled ? '' : ' és a szimulátor brokerbeállításában'} is ezt kell megadni.`,
    );
  }
  if (broker.external) {
    result.push(
      `A külső broker (${broker.host}:${broker.port}) elérhetőségéről neked kell gondoskodnod; a gépen futó brokert a konténerekből a host.docker.internal név éri el.`,
    );
  }
  if (options.simulator.enabled) {
    result.push(
      `A szimulátor képét (${options.simulator.image}) a compose nem tölti le: előbb építsd meg (docker build -t ${options.simulator.image} .).`,
    );
    result.push(
      'Ha ugyanazon a gépen a szimulátor saját docker-compose.yml-je is fut, a 3000-es és az 1883-as port ütközik; SIMULATOR_PORT és MQTT_PORT változóval feloldható.',
    );
    if (options.simulator.seedDevices) {
      result.push(
        `Mentsd a Beállítások oldal exportját ide: ${SIMULATOR_SEED_PATH}; enélkül a szimulátor nem indul el.`,
      );
    }
  }
  return result;
}
