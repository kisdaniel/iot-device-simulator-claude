import { readFileSync } from 'node:fs';
import type { BrokerSettings } from '@iot-sim/shared';

export type ConfigImportMode = 'seed' | 'merge' | 'replace';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface AppConfig {
  port: number;
  dataDir: string;
  /** null, ha a MQTT_URL nincs megadva: ilyenkor az adatbázisban tárolt beállítás él */
  mqtt: BrokerSettings | null;
  mqttClientId: string | null;
  mqttCaFile: string | null;
  mqttRejectUnauthorized: boolean;
  configFile: string | null;
  configImportMode: ConfigImportMode;
  logLevel: LogLevel;
  messageLogSize: number;
}

export class EnvValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Hibás környezeti változók:\n- ${problems.join('\n- ')}`);
  }
}

type Env = Record<string, string | undefined>;

function intVar(
  env: Env,
  name: string,
  fallback: number,
  min: number,
  max: number,
  problems: string[],
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push(
      `${name}: ${min} és ${max} közötti egész szám kell, ez érkezett: "${raw}"`,
    );
    return fallback;
  }
  return value;
}

function boolVar(
  env: Env,
  name: string,
  fallback: boolean,
  problems: string[],
): boolean {
  const raw = env[name]?.toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  problems.push(
    `${name}: "true" vagy "false" kell, ez érkezett: "${env[name]}"`,
  );
  return fallback;
}

function enumVar<T extends string>(
  env: Env,
  name: string,
  allowed: readonly T[],
  fallback: T,
  problems: string[],
): T {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  problems.push(
    `${name}: megengedett értékek: ${allowed.join(', ')}; ez érkezett: "${raw}"`,
  );
  return fallback;
}

function parseMqtt(env: Env, problems: string[]): BrokerSettings | null {
  const raw = env.MQTT_URL;
  if (raw === undefined || raw === '') return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    problems.push(`MQTT_URL: nem értelmezhető URL: "${raw}"`);
    return null;
  }
  if (url.protocol !== 'mqtt:' && url.protocol !== 'mqtts:') {
    problems.push(
      `MQTT_URL: a séma mqtt:// vagy mqtts:// lehet, ez érkezett: "${url.protocol}//"`,
    );
    return null;
  }
  const tls = url.protocol === 'mqtts:';

  let password: string | null = env.MQTT_PASSWORD || null;
  const passwordFile = env.MQTT_PASSWORD_FILE;
  if (passwordFile) {
    try {
      password = readFileSync(passwordFile, 'utf8').trim();
    } catch (err) {
      problems.push(
        `MQTT_PASSWORD_FILE: a fájl nem olvasható (${(err as Error).message})`,
      );
    }
  }

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : tls ? 8883 : 1883,
    tls,
    username: env.MQTT_USERNAME || decodeURIComponent(url.username) || null,
    password: password ?? (decodeURIComponent(url.password) || null),
  };
}

/** Beolvassa és ellenőrzi a környezeti változókat; hibánál minden problémát egyszerre jelez. */
export function loadConfig(env: Env = process.env): AppConfig {
  const problems: string[] = [];
  const config: AppConfig = {
    port: intVar(env, 'PORT', 3000, 1, 65535, problems),
    dataDir: env.DATA_DIR || './data',
    mqtt: parseMqtt(env, problems),
    mqttClientId: env.MQTT_CLIENT_ID || null,
    mqttCaFile: env.MQTT_CA_FILE || null,
    mqttRejectUnauthorized: boolVar(
      env,
      'MQTT_REJECT_UNAUTHORIZED',
      true,
      problems,
    ),
    configFile: env.CONFIG_FILE || null,
    configImportMode: enumVar(
      env,
      'CONFIG_IMPORT_MODE',
      ['seed', 'merge', 'replace'] as const,
      'seed',
      problems,
    ),
    logLevel: enumVar(
      env,
      'LOG_LEVEL',
      ['error', 'warn', 'info', 'debug'] as const,
      'info',
      problems,
    ),
    messageLogSize: intVar(env, 'MESSAGE_LOG_SIZE', 200, 0, 10000, problems),
  };
  if (problems.length > 0) throw new EnvValidationError(problems);
  return config;
}
