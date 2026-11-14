/**
 * Közös típusok a backend és a frontend között.
 * A mezők jelentését a docs/technikai-specifikacio.md „Adatmodell” szakasza írja le.
 */

export type DeviceType = 'shelly-1pm' | 'shelly-2pm' | 'tasmota';
export type ShellyGeneration = 2 | 3 | 4;

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

/** A brokerbeállítás, ahogy az adatbázisban és a környezetben él (jelszóval). */
export interface BrokerSettings {
  host: string;
  port: number;
  tls: boolean;
  username: string | null;
  password: string | null;
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
}

export interface BrokerTestResult {
  ok: boolean;
  error?: string;
}

export interface HealthStatus {
  status: 'ok';
  version: string;
}

export const DEFAULT_BROKER_SETTINGS: BrokerSettings = {
  host: 'localhost',
  port: 1883,
  tls: false,
  username: null,
  password: null,
};
