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
  return resolveFullTopic(config.fullTopic, config.topic, config.mac, prefix, command);
}

/** A csoporttopic parancstopicja, pl. cmnd/tasmotas/POWER. */
export function tasmotaGroupTopic(
  config: Pick<TasmotaConfig, 'fullTopic' | 'groupTopic' | 'mac'>,
  command = '',
): string {
  return resolveFullTopic(config.fullTopic, config.groupTopic, config.mac, 'cmnd', command);
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
export function tasmotaDiscoveryTopic(mac: string, kind: 'config' | 'sensors'): string {
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
