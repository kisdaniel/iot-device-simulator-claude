/**
 * Közös típusok a backend és a frontend között.
 * A mezők jelentését a docs/technikai-specifikacio.md „Adatmodell” szakasza írja le.
 */

export type DeviceType = 'shelly-1pm' | 'shelly-2pm' | 'tasmota';
export type ShellyDeviceType = Exclude<DeviceType, 'tasmota'>;
export type ShellyGeneration = 2 | 3 | 4;

export const SHELLY_DEVICE_TYPES: readonly ShellyDeviceType[] = [
  'shelly-1pm',
  'shelly-2pm',
];
export const SHELLY_GENERATIONS: readonly ShellyGeneration[] = [2, 3, 4];

/** A Shelly típusok kapcsolóinak száma. */
export const SHELLY_SWITCH_COUNT: Record<ShellyDeviceType, number> = {
  'shelly-1pm': 1,
  'shelly-2pm': 2,
};

export interface ShellyModelInfo {
  /** Az eszközazonosító eleje, a kötőjel és a MAC előtt */
  idPrefix: string;
  /** A Shelly.GetDeviceInfo `model` mezője */
  model: string;
  /** A Shelly.GetDeviceInfo `app` mezője */
  app: string;
  /** Megjelenített terméknév */
  name: string;
}

/**
 * Azonosítók és modellkódok generációnként. Az 1PM Gen3 és a 2PM Gen4 gyártói
 * forrásból származik; a többi sor a névmintából következtetett, valós eszközzel
 * ellenőrizendő (lásd docs/technikai-specifikacio.md, „Azonosítók”).
 */
export const SHELLY_MODELS: Record<
  ShellyDeviceType,
  Record<ShellyGeneration, ShellyModelInfo>
> = {
  'shelly-1pm': {
    2: {
      idPrefix: 'shellyplus1pm',
      model: 'SNSW-001P16EU',
      app: 'Plus1PM',
      name: 'Shelly Plus 1PM',
    },
    3: {
      idPrefix: 'shelly1pmg3',
      model: 'S3SW-001P16EU',
      app: 'S1PMG3',
      name: 'Shelly 1PM Gen3',
    },
    4: {
      idPrefix: 'shelly1pmg4',
      model: 'S4SW-001P16EU',
      app: 'S1PMG4',
      name: 'Shelly 1PM Gen4',
    },
  },
  'shelly-2pm': {
    2: {
      idPrefix: 'shellyplus2pm',
      model: 'SNSW-102P16EU',
      app: 'Plus2PM',
      name: 'Shelly Plus 2PM',
    },
    3: {
      idPrefix: 'shelly2pmg3',
      model: 'S3SW-002P16EU',
      app: 'S2PMG3',
      name: 'Shelly 2PM Gen3',
    },
    4: {
      idPrefix: 'shelly2pmg4',
      model: 'S4SW-002P16EU',
      app: 'S2PMG4',
      name: 'Shelly 2PM Gen4',
    },
  },
};

/** Shelly eszközazonosító, pl. shelly1pmg3-a8032abe54dc. */
export function shellyDeviceId(
  type: ShellyDeviceType,
  generation: ShellyGeneration,
  mac: string,
): string {
  return `${SHELLY_MODELS[type][generation].idPrefix}-${mac.toLowerCase()}`;
}

export interface ShellyConfig {
  generation: ShellyGeneration;
  /** pl. shellyplus1pm-a8032abe54dc, shelly1pmg3-a8032abe54dc */
  deviceId: string;
  /** null = deviceId */
  topicPrefix: string | null;
  rpcNtf: boolean;
  statusNtf: boolean;
  enableControl: boolean;
  addon: { enabled: boolean; sensorCount: number };
}

/** Az Add-on első hőmérőjének komponensazonosítója (temperature:100). */
export const SHELLY_ADDON_FIRST_ID = 100;
/** Az Add-onra köthető DS18B20 hőmérők legnagyobb száma. */
export const SHELLY_ADDON_MAX_SENSORS = 5;

/** A hőmérő megengedett tartománya (°C), a DS18B20 adatlapja szerint. */
export const TEMPERATURE_MIN_C = -55;
export const TEMPERATURE_MAX_C = 125;

/** A ténylegesen használt topic-előtag: a megadott előtag, vagy ha nincs, az eszközazonosító. */
export function shellyTopicPrefix(
  config: Pick<ShellyConfig, 'topicPrefix' | 'deviceId'>,
): string {
  return config.topicPrefix || config.deviceId;
}

export interface TasmotaConfig {
  /** 12 hex jegy, nagybetűs; a discovery topicjához */
  mac: string;
  topic: string;
  fullTopic: string;
  groupTopic: string;
  relayCount: number;
  hasEnergy: boolean;
  sensorCount: number;
  discovery: boolean;
  telePeriod: number;
  publishOnChange: boolean;
  powerRetain: boolean;
}

export const TASMOTA_MAX_RELAYS = 8;
export const TASMOTA_MAX_SENSORS = 8;
export const TASMOTA_TELEPERIOD_MIN = 10;
export const TASMOTA_TELEPERIOD_MAX = 3600;

/** A Tasmota alapértékei (FullTopic, GroupTopic, TelePeriod, SetOption-ök). */
export const TASMOTA_DEFAULTS = {
  fullTopic: '%prefix%/%topic%/',
  groupTopic: 'tasmotas',
  telePeriod: 300,
  publishOnChange: true,
  powerRetain: false,
} as const;

export type TasmotaPrefix = 'cmnd' | 'stat' | 'tele';

/** Az alapértelmezett topic a MAC utolsó hat jegyéből, pl. tasmota_BE54DC. */
export function defaultTasmotaTopic(mac: string): string {
  return `tasmota_${mac.slice(-6).toUpperCase()}`;
}

function resolveFullTopic(
  fullTopic: string,
  topic: string,
  mac: string,
  prefix: TasmotaPrefix,
  command: string,
): string {
  let resolved = fullTopic
    .replaceAll('%prefix%', prefix)
    .replaceAll('%topic%', topic)
    .replaceAll('%id%', mac.slice(-6).toUpperCase());
  if (!resolved.endsWith('/')) resolved += '/';
  return resolved + command;
}

/** Az eszköz teljes topicja egy előtaggal, pl. stat/tasmota_BE54DC/RESULT. */
export function tasmotaTopic(
  config: Pick<TasmotaConfig, 'fullTopic' | 'topic' | 'mac'>,
  prefix: TasmotaPrefix,
  command = '',
): string {
  return resolveFullTopic(
    config.fullTopic,
    config.topic,
    config.mac,
    prefix,
    command,
  );
}

/** A csoporttopic parancstopicja, pl. cmnd/tasmotas/POWER. */
export function tasmotaGroupTopic(
  config: Pick<TasmotaConfig, 'fullTopic' | 'groupTopic' | 'mac'>,
  command = '',
): string {
  return resolveFullTopic(
    config.fullTopic,
    config.groupTopic,
    config.mac,
    'cmnd',
    command,
  );
}

/** A relé kulcsa: egy relénél POWER, többnél POWER1 … POWERn. */
export function tasmotaPowerKey(relayCount: number, index: number): string {
  return relayCount === 1 ? 'POWER' : `POWER${index + 1}`;
}

/** A hőmérő kulcsa: egynél DS18B20, többnél DS18B20-1 … DS18B20-n. */
export function tasmotaSensorKey(sensorCount: number, index: number): string {
  return sensorCount === 1 ? 'DS18B20' : `DS18B20-${index + 1}`;
}

export interface MeterState {
  loadPower: number;
  voltage: number;
  currentOverride: number | null;
  powerFactor: number;
  frequency: number;
  energyTotalWh: number;
  energyTodayWh: number;
  energyYesterdayWh: number;
  energyUpdatedAt: string;
}

export interface SwitchState {
  index: number;
  output: boolean;
  source: string;
  meter?: MeterState;
}

export type TemperatureError = 'read' | 'out_of_range';

export interface TemperatureState {
  index: number;
  address: string;
  tC: number | null;
  error: TemperatureError | null;
}

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  enabled: boolean;
  shelly?: ShellyConfig;
  tasmota?: TasmotaConfig;
  switches: SwitchState[];
  sensors: TemperatureState[];
}

export type DeviceRunStatus = 'online' | 'offline';

/** Egy eszköz, ahogy az API kiadja: a tárolt adatok és a futási állapot. */
export interface DeviceView extends Device {
  status: DeviceRunStatus;
}

/** A Tasmota beállításai felvételkor; az elhagyott mezők alapértéket kapnak. */
export interface TasmotaSettings {
  /** 12 hexadecimális jegy; elhagyva véletlenszerű */
  mac?: string;
  /** elhagyva tasmota_<a MAC utolsó hat jegye> */
  topic?: string;
  fullTopic?: string;
  groupTopic?: string;
  relayCount: number;
  hasEnergy: boolean;
  sensorCount: number;
  telePeriod?: number;
  publishOnChange?: boolean;
  powerRetain?: boolean;
  /** Tasmota discovery (Home Assistant Tasmota integráció); alapból kikapcsolva */
  discovery?: boolean;
}

/** A Tasmota discovery topicja a MAC-címmel, pl. tasmota/discovery/A8032ABE54DC/config. */
export function tasmotaDiscoveryTopic(
  mac: string,
  kind: 'config' | 'sensors',
): string {
  return `tasmota/discovery/${mac.toUpperCase()}/${kind}`;
}

/** POST /api/devices törzse; a típusnak megfelelő beállítás kötelező. */
export interface CreateDeviceRequest {
  name: string;
  type: DeviceType;
  enabled?: boolean;
  tasmota?: TasmotaSettings;
  shelly?: {
    generation: ShellyGeneration;
    /** 12 hexadecimális jegy; elhagyva véletlenszerű */
    mac?: string;
    topicPrefix?: string | null;
    rpcNtf?: boolean;
    statusNtf?: boolean;
    enableControl?: boolean;
    addon?: { enabled: boolean; sensorCount: number };
  };
}

/** PATCH /api/devices/:id törzse; az elhagyott mezők nem változnak. */
export interface UpdateDeviceRequest {
  name?: string;
  shelly?: {
    /** null vagy üres: az eszközazonosító lesz az előtag */
    topicPrefix?: string | null;
    rpcNtf?: boolean;
    statusNtf?: boolean;
    enableControl?: boolean;
    /** Változásakor az eszköz újraindul, mint a valódi a perifériák átállítása után */
    addon?: { enabled: boolean; sensorCount: number };
  };
  /** A relék, a mérő vagy a hőmérők számának változásakor az eszköz újraindul. */
  tasmota?: Partial<Omit<TasmotaSettings, 'mac'>>;
}

/** PUT /api/devices/:id/sensors/:index törzse. */
export interface SetSensorRequest {
  /** °C; null csak hibával együtt */
  tC?: number | null;
  /** Szenzorhiba szimulációja; null: nincs hiba */
  error?: TemperatureError | null;
}

/** A brokerbeállítás, ahogy az adatbázisban és a környezetben él (jelszóval). */
export interface BrokerSettings {
  host: string;
  port: number;
  tls: boolean;
  username: string | null;
  password: string | null;
}

export type BrokerConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'error';

export interface BrokerConnection {
  status: BrokerConnectionStatus;
  /** Az utolsó hiba szövege, ha a kapcsolat nem él */
  error?: string;
}

/** A GET /api/broker válasza: a jelszó soha nem megy ki. */
export interface BrokerSettingsView {
  host: string;
  port: number;
  tls: boolean;
  username: string | null;
  hasPassword: boolean;
  /** true, ha a beállítás környezeti változóból jön, és nem szerkeszthető */
  managedByEnv: boolean;
  /** A közös MQTT-kapcsolat pillanatnyi állapota */
  connection: BrokerConnection;
}

export interface BrokerTestResult {
  ok: boolean;
  error?: string;
}

export interface HealthStatus {
  status: 'ok';
  version: string;
  mqtt: BrokerConnectionStatus;
}

export const DEFAULT_BROKER_SETTINGS: BrokerSettings = {
  host: 'localhost',
  port: 1883,
  tls: false,
  username: null,
  password: null,
};

/** Egy eszköz küldött vagy fogadott MQTT-üzenete az üzenetnaplóban. */
export interface MqttLogEntry {
  deviceId: string;
  /** ISO időbélyeg */
  ts: string;
  direction: 'in' | 'out';
  topic: string;
  payload: string;
  retain: boolean;
}

/** A GET /api/events (SSE) eseményei: az esemény neve a `type`, a törzse a `data`. */
export type SimEvent =
  | { type: 'device.updated'; data: DeviceView }
  | { type: 'device.removed'; data: { id: string } }
  | { type: 'device.connection'; data: { id: string; status: DeviceRunStatus } }
  | { type: 'broker.status'; data: BrokerConnection }
  | { type: 'mqtt.message'; data: MqttLogEntry };

export type SimEventType = SimEvent['type'];

export const SIM_EVENT_TYPES: readonly SimEventType[] = [
  'device.updated',
  'device.removed',
  'device.connection',
  'broker.status',
  'mqtt.message',
];

/** A közös kapcsolat saját állapottopicja; ez a kapcsolat egyetlen végakarata (LWT). */
export const SIMULATOR_STATUS_TOPIC = 'iot-simulator/status';

/** A generált Home Assistant konfiguráció fájlneve. */
export const HOMEASSISTANT_CONFIG_FILE = 'iot_simulator.yaml';

/**
 * Ide mentse a felhasználó a generált konfigurációt, a docker-compose.yml-hez képest;
 * a compose ezt a mappát csatolja a Home Assistant csomagkönyvtárának.
 */
export const HOMEASSISTANT_PACKAGES_DIR = 'homeassistant/packages';
export const HOMEASSISTANT_CONFIG_PATH = `${HOMEASSISTANT_PACKAGES_DIR}/${HOMEASSISTANT_CONFIG_FILE}`;

/** A GET /api/homeassistant/config válasza. */
export interface HomeAssistantConfigResult {
  /** A configuration.yaml-ba másolható `mqtt:` blokk */
  yaml: string;
  /** Home Assistant és Mosquitto docker-compose.yml; a fenti konfigurációt a HOMEASSISTANT_CONFIG_PATH útvonalról tölti be */
  compose: string;
  /** A konfigurációba került eszközök száma */
  deviceCount: number;
  /** A létrehozott entitások száma */
  entityCount: number;
  /** Figyelmeztetések (kihagyott eszközök, korlátozott állapotjelentés) */
  warnings: string[];
}

/** A JSON konfigurációs fájl formátumának verziója. */
export const CONFIG_FILE_VERSION = 1;

/**
 * Az import módja. `seed`: csak üres adatbázisba tölt; `merge`: a fájlban szereplő
 * eszközöket létrehozza vagy frissíti, a többit békén hagyja; `replace`: az eszközlista
 * pontosan a fájl tartalma lesz.
 */
export type ImportMode = 'seed' | 'merge' | 'replace';
export const IMPORT_MODES: readonly ImportMode[] = ['seed', 'merge', 'replace'];

/** A mérő fájlban megadható mezői; a hiányzók az alapértéket (frissítésnél a meglévőt) kapják. */
export type ConfigFileMeter = Partial<Omit<MeterState, 'energyUpdatedAt'>>;

export interface ConfigFileSwitch {
  index: number;
  output?: boolean;
  meter?: ConfigFileMeter;
}

export interface ConfigFileSensor {
  index: number;
  /** A DS18B20 64 bites címe (16 hex jegy); elhagyva a meglévő vagy egy új cím. */
  address?: string;
  tC?: number | null;
  error?: TemperatureError | null;
}

export interface ConfigFileDevice {
  name: string;
  type: DeviceType;
  enabled?: boolean;
  shelly?: Partial<Omit<ShellyConfig, 'deviceId' | 'generation'>> &
    Pick<ShellyConfig, 'deviceId' | 'generation'>;
  tasmota?: Partial<Omit<TasmotaConfig, 'topic'>> &
    Pick<TasmotaConfig, 'topic'>;
  /** Kezdő vagy pillanatnyi állapot; elhagyva frissítésnél a meglévő marad. */
  switches?: ConfigFileSwitch[];
  sensors?: ConfigFileSensor[];
}

/** Az import és az export közös formátuma. */
export interface ConfigFile {
  version: typeof CONFIG_FILE_VERSION;
  /** Az export ideje; importnál nincs jelentősége. */
  exportedAt?: string;
  /** A broker címe jelszó nélkül; környezeti változós beállításnál importkor figyelmen kívül marad. */
  broker?: { url: string; username?: string | null } | null;
  devices: ConfigFileDevice[];
}

/** Egy eszköz az import összesítőjében. */
export interface ImportItem {
  name: string;
  type: DeviceType;
  /** A Shelly deviceId, ill. a Tasmota topic: ez azonosítja az eszközt importkor. */
  identity: string;
}

/** Az import (vagy a dryRun) eredménye. */
export interface ImportSummary {
  mode: ImportMode;
  /** Igaz, ha az import ténylegesen beíródott (dryRun és kihagyott seed esetén hamis). */
  applied: boolean;
  /** `seed` módban igaz, ha az adatbázisban már voltak eszközök, ezért semmi sem történt. */
  skipped: boolean;
  created: ImportItem[];
  updated: ImportItem[];
  unchanged: ImportItem[];
  removed: ImportItem[];
  /** A broker szakasz sorsa: nincs a fájlban, változatlan, frissül, vagy (MQTT_URL miatt) figyelmen kívül marad. */
  broker: 'absent' | 'unchanged' | 'updated' | 'ignored';
}

/** Mezőszintű importhiba; a `path` pl. `devices[2].shelly.generation`. */
export interface ImportError {
  path: string;
  /** Az érintett eszköz neve a fájlból, ha a hiba egy eszközhöz tartozik. */
  device?: string;
  message: string;
}

/** A hibás importra adott 400-as válasz törzse. */
export interface ImportErrorResponse {
  message: string;
  errors: ImportError[];
}
