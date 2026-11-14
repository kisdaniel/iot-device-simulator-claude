import { randomBytes, randomUUID } from 'node:crypto';
import {
  CONFIG_FILE_VERSION,
  type ConfigFile,
  type ConfigFileDevice,
  type ConfigFileMeter,
  type Device,
  type ImportError,
  type ImportItem,
  type ImportMode,
  type MeterState,
  SHELLY_MODELS,
  SHELLY_SWITCH_COUNT,
  type ShellyConfig,
  type ShellyDeviceType,
  shellyDeviceId,
  shellyTopicPrefix,
  type SwitchState,
  TASMOTA_DEFAULTS,
  type TasmotaConfig,
  tasmotaTopic,
} from '@iot-sim/shared';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import {
  normalizeFullTopic,
  resizeSwitches,
} from '../devices/devices.service.js';
import { commitDeviceEnergy, defaultMeter } from '../simulation/meter.js';
import { resizeSensors } from '../simulation/sensors.js';
import { ConfigFileDto, type ConfigFileDeviceDto } from './config-file.dto.js';

/** A validálás eredménye: a beolvasott fájl, vagy a mezőszintű hibák. */
export type ParseResult =
  | { file: ConfigFileDto; errors?: undefined }
  | { file?: undefined; errors: ImportError[] };

/** A fájl szerkezetének és mezőinek ellenőrzése a DTO-szabályokkal. */
export function parseConfigFile(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      errors: [{ path: '', message: 'a fájl tartalma egy JSON objektum' }],
    };
  }
  const file = plainToInstance(ConfigFileDto, raw);
  const issues = validateSync(file, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (issues.length === 0) return { file };
  const devices = (raw as { devices?: unknown }).devices;
  return { errors: flatten(issues, '', Array.isArray(devices) ? devices : []) };
}

/** Az importterv: mi jön létre, mi frissül, mi marad, mi törlődik. */
export interface ImportPlan {
  mode: ImportMode;
  skipped: boolean;
  create: Device[];
  update: Device[];
  unchanged: Device[];
  remove: Device[];
}

export type PlanResult =
  | { plan: ImportPlan; errors?: undefined }
  | { plan?: undefined; errors: ImportError[] };

/**
 * A validált fájl összevetése a meglévő eszközökkel. Az eszközt a Shelly `deviceId`,
 * ill. a Tasmota `topic` azonosítja. A fájlbeli eszköz teljes leírás: a hiányzó
 * beállítás az alapértéket kapja; az állapot (kapcsolók, mérők, hőmérők) csak akkor
 * változik, ha a fájl megadja, különben frissítésnél a meglévő marad.
 */
export function planImport(
  file: ConfigFileDto,
  existing: readonly Device[],
  mode: ImportMode,
  now: Date = new Date(),
): PlanResult {
  const empty: ImportPlan = {
    mode,
    skipped: false,
    create: [],
    update: [],
    unchanged: [],
    remove: [],
  };
  if (mode === 'seed' && existing.length > 0) {
    return { plan: { ...empty, skipped: true } };
  }

  const errors: ImportError[] = [];
  const plan = empty;
  const matched = new Set<string>();
  const built: { device: Device; index: number }[] = [];

  file.devices.forEach((entry, index) => {
    const at = (field: string) =>
      `devices[${index}]${field ? `.${field}` : ''}`;
    const fail = (field: string, message: string) =>
      errors.push({ path: at(field), device: entry.name, message });
    const current = existing.find(
      (d) =>
        identityOf(d) === identityOfEntry(entry) && family(d) === family(entry),
    );
    if (current) {
      if (matched.has(current.id)) {
        fail(
          identityField(entry),
          `kétszer szerepel a fájlban: ${identityOfEntry(entry)}`,
        );
        return;
      }
      matched.add(current.id);
    }
    const device =
      entry.type === 'tasmota'
        ? buildTasmota(entry, current, now, fail)
        : buildShelly(entry, current, now, fail);
    if (!device) return;
    applyState(device, entry, now, fail);
    built.push({ device, index });
  });

  // A megmaradó eszközökkel együtt sem lehet két azonos azonosító vagy topic.
  const kept =
    mode === 'merge' ? existing.filter((d) => !matched.has(d.id)) : [];
  checkUnique(built, kept, file.devices, errors);
  if (errors.length > 0) return { errors };

  for (const { device } of built) {
    const current = existing.find((d) => d.id === device.id);
    if (!current) plan.create.push(device);
    else if (sameDevice(current, device)) plan.unchanged.push(current);
    else plan.update.push(device);
  }
  if (mode === 'replace') {
    plan.remove = existing.filter((d) => !matched.has(d.id));
  }
  return { plan };
}

/** Az összesítőben megjelenő adatok egy eszközről. */
export function importItem(device: Device): ImportItem {
  return { name: device.name, type: device.type, identity: identityOf(device) };
}

/**
 * A konfiguráció exportja. Állapottal együtt a mérők a pillanatnyi (integrált)
 * energiát kapják; a broker jelszava soha nem kerül bele.
 */
export function exportConfig(
  devices: readonly Device[],
  broker: ConfigFile['broker'],
  includeState: boolean,
  now: Date = new Date(),
): ConfigFile {
  return {
    version: CONFIG_FILE_VERSION,
    exportedAt: now.toISOString(),
    ...(broker ? { broker } : {}),
    devices: devices.map((source) => {
      const device = structuredClone(source);
      if (includeState) commitDeviceEnergy(device, now);
      const entry: ConfigFileDevice = {
        name: device.name,
        type: device.type,
        enabled: device.enabled,
      };
      if (device.shelly) entry.shelly = { ...device.shelly };
      if (device.tasmota) entry.tasmota = { ...device.tasmota };
      if (includeState) {
        entry.switches = device.switches.map((s) => ({
          index: s.index,
          output: s.output,
          ...(s.meter ? { meter: exportMeter(s.meter) } : {}),
        }));
      }
      if (device.sensors.length > 0) {
        // A cím a hőmérő azonosítója, ezért állapot nélkül is megmarad.
        entry.sensors = device.sensors.map((s) => ({
          index: s.index,
          address: s.address,
          ...(includeState ? { tC: s.tC, error: s.error } : {}),
        }));
      }
      return entry;
    }),
  };
}

function exportMeter(meter: MeterState): ConfigFileMeter {
  const { energyUpdatedAt: _updatedAt, ...rest } = meter;
  return rest;
}

type Fail = (field: string, message: string) => void;

function buildShelly(
  entry: ConfigFileDeviceDto,
  current: Device | undefined,
  now: Date,
  fail: Fail,
): Device | null {
  const type = entry.type as ShellyDeviceType;
  const s = entry.shelly!;
  const prefix = SHELLY_MODELS[type][s.generation].idPrefix;
  const deviceId = s.deviceId.toLowerCase();
  const mac = deviceId.slice(prefix.length + 1);
  if (
    !/^[0-9a-f]{12}$/.test(mac) ||
    deviceId !== shellyDeviceId(type, s.generation, mac)
  ) {
    fail(
      'shelly.deviceId',
      `${type} ${s.generation}. generációnál az eszközazonosító ${prefix}-<12 hexadecimális jegy> alakú`,
    );
    return null;
  }
  let addon: ShellyConfig['addon'] = { enabled: false, sensorCount: 0 };
  if (s.addon?.enabled) {
    if (s.addon.sensorCount < 1) {
      fail(
        'shelly.addon.sensorCount',
        'bekapcsolt Add-onhoz legalább egy hőmérő kell (1–5)',
      );
      return null;
    }
    addon = { enabled: true, sensorCount: s.addon.sensorCount };
  }
  const switches: SwitchState[] = Array.from(
    { length: SHELLY_SWITCH_COUNT[type] },
    (_, index) => {
      const state = current?.switches.find((x) => x.index === index);
      return state
        ? { ...structuredClone(state), meter: state.meter ?? defaultMeter(now) }
        : { index, output: false, source: 'init', meter: defaultMeter(now) };
    },
  );
  return {
    id: current?.id ?? randomUUID(),
    name: entry.name.trim(),
    type,
    enabled: entry.enabled ?? true,
    shelly: {
      generation: s.generation,
      deviceId,
      topicPrefix: s.topicPrefix || null,
      rpcNtf: s.rpcNtf ?? true,
      statusNtf: s.statusNtf ?? true,
      enableControl: s.enableControl ?? true,
      addon,
    },
    switches,
    sensors: resizeSensors(current?.sensors ?? [], addon.sensorCount),
  };
}

function buildTasmota(
  entry: ConfigFileDeviceDto,
  current: Device | undefined,
  _now: Date,
  fail: Fail,
): Device | null {
  const t = entry.tasmota!;
  const config: TasmotaConfig = {
    mac: (
      t.mac ??
      current?.tasmota?.mac ??
      randomBytes(6).toString('hex')
    ).toUpperCase(),
    topic: t.topic,
    fullTopic: normalizeFullTopic(t.fullTopic ?? TASMOTA_DEFAULTS.fullTopic),
    groupTopic: t.groupTopic ?? TASMOTA_DEFAULTS.groupTopic,
    relayCount: t.relayCount ?? 1,
    hasEnergy: t.hasEnergy ?? false,
    sensorCount: t.sensorCount ?? 0,
    discovery: t.discovery ?? false,
    telePeriod: t.telePeriod ?? TASMOTA_DEFAULTS.telePeriod,
    publishOnChange: t.publishOnChange ?? TASMOTA_DEFAULTS.publishOnChange,
    powerRetain: t.powerRetain ?? TASMOTA_DEFAULTS.powerRetain,
  };
  if (config.topic === config.groupTopic) {
    fail('tasmota.groupTopic', 'a topic és a csoporttopic nem lehet azonos');
    return null;
  }
  return {
    id: current?.id ?? randomUUID(),
    name: entry.name.trim(),
    type: 'tasmota',
    enabled: entry.enabled ?? true,
    tasmota: config,
    switches: resizeSwitches(
      current?.switches ?? [],
      config.relayCount,
      config.hasEnergy,
    ),
    sensors: resizeSensors(current?.sensors ?? [], config.sensorCount),
  };
}

/** A fájlban megadott állapot ráírása a felépített eszközre. */
function applyState(
  device: Device,
  entry: ConfigFileDeviceDto,
  now: Date,
  fail: Fail,
): void {
  const seen = new Set<number>();
  entry.switches?.forEach((item, k) => {
    const state = device.switches.find((s) => s.index === item.index);
    if (!state) {
      fail(
        `switches[${k}].index`,
        `nincs ${item.index}. kapcsoló; a sorszám 0 és ${device.switches.length - 1} között lehet`,
      );
      return;
    }
    if (seen.has(item.index)) {
      fail(
        `switches[${k}].index`,
        `a(z) ${item.index}. kapcsoló kétszer szerepel`,
      );
      return;
    }
    seen.add(item.index);
    // A forrás csak akkor lesz „init”, ha a kimenet ténylegesen változik.
    if (item.output !== undefined && item.output !== state.output) {
      state.output = item.output;
      state.source = 'init';
    }
    if (item.meter) {
      if (!state.meter) {
        fail(
          `switches[${k}].meter`,
          `a(z) ${item.index}. kapcsolónak nincs mérője`,
        );
        return;
      }
      Object.assign(state.meter, definedOnly(item.meter), {
        energyUpdatedAt: now.toISOString(),
      });
    }
  });

  const seenSensors = new Set<number>();
  entry.sensors?.forEach((item, k) => {
    const state = device.sensors.find((s) => s.index === item.index);
    if (!state) {
      fail(
        `sensors[${k}].index`,
        device.sensors.length === 0
          ? 'az eszköznek nincs hőmérője'
          : `nincs ${item.index}. hőmérő; a sorszám 0 és ${device.sensors.length - 1} között lehet`,
      );
      return;
    }
    if (seenSensors.has(item.index)) {
      fail(
        `sensors[${k}].index`,
        `a(z) ${item.index}. hőmérő kétszer szerepel`,
      );
      return;
    }
    seenSensors.add(item.index);
    if (item.address !== undefined) state.address = item.address.toUpperCase();
    if (item.tC !== undefined) {
      state.tC = item.tC === null ? null : Math.round(item.tC * 10) / 10;
    }
    if (item.error !== undefined) state.error = item.error;
  });
}

/** Az azonosítók és a topicok egyedisége a fájlon belül és a megmaradó eszközökkel. */
function checkUnique(
  built: readonly { device: Device; index: number }[],
  kept: readonly Device[],
  entries: readonly ConfigFileDeviceDto[],
  errors: ImportError[],
): void {
  const owners = new Map<string, string>();
  for (const device of kept) {
    for (const key of uniqueKeys(device))
      owners.set(key, `a meglévő „${device.name}” eszköz`);
  }
  for (const { device, index } of built) {
    const field = device.shelly ? 'shelly.deviceId' : 'tasmota.topic';
    for (const key of uniqueKeys(device)) {
      const owner = owners.get(key);
      if (owner) {
        errors.push({
          path: `devices[${index}].${field}`,
          device: entries[index].name,
          message: `ütközik: ${owner} már használja (${key.slice(key.indexOf(':') + 1)})`,
        });
        break;
      }
    }
    for (const key of uniqueKeys(device)) {
      owners.set(key, `a fájl ${index + 1}. eszköze („${device.name}”)`);
    }
  }
}

/** Az egyedi kulcsok: Shelly azonosító és topic-előtag, Tasmota topic és parancstopic. */
function uniqueKeys(device: Device): string[] {
  if (device.shelly) {
    return [
      `shelly-id:${device.shelly.deviceId}`,
      `shelly-prefix:${shellyTopicPrefix(device.shelly)}`,
    ];
  }
  if (device.tasmota) {
    return [
      `tasmota-topic:${device.tasmota.topic}`,
      `tasmota-cmnd:${tasmotaTopic(device.tasmota, 'cmnd')}`,
    ];
  }
  return [];
}

function identityOf(device: Device): string {
  return device.shelly?.deviceId ?? device.tasmota?.topic ?? device.id;
}

function identityOfEntry(entry: ConfigFileDeviceDto): string {
  return entry.type === 'tasmota'
    ? entry.tasmota!.topic
    : entry.shelly!.deviceId.toLowerCase();
}

function identityField(entry: ConfigFileDeviceDto): string {
  return entry.type === 'tasmota' ? 'tasmota.topic' : 'shelly.deviceId';
}

function family(device: { type: string }): 'shelly' | 'tasmota' {
  return device.type === 'tasmota' ? 'tasmota' : 'shelly';
}

/** Ugyanaz-e a két eszköz, az energia időbélyegét nem számítva. */
function sameDevice(a: Device, b: Device): boolean {
  const normalize = (d: Device) =>
    JSON.stringify({
      ...d,
      switches: d.switches.map((s) =>
        s.meter ? { ...s, meter: { ...s.meter, energyUpdatedAt: '' } } : s,
      ),
    });
  return normalize(a) === normalize(b);
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** A class-validator hibafa lapítása `devices[2].shelly.generation` alakú útvonalakra. */
function flatten(
  issues: readonly ValidationError[],
  parent: string,
  devices: readonly unknown[],
): ImportError[] {
  const result: ImportError[] = [];
  for (const issue of issues) {
    const path = /^\d+$/.test(issue.property)
      ? `${parent}[${issue.property}]`
      : parent
        ? `${parent}.${issue.property}`
        : issue.property;
    for (const [key, message] of Object.entries(issue.constraints ?? {})) {
      result.push({
        path,
        ...deviceName(path, devices),
        message: translate(key, message),
      });
    }
    if (issue.children?.length) {
      result.push(...flatten(issue.children, path, devices));
    }
  }
  return result;
}

function deviceName(
  path: string,
  devices: readonly unknown[],
): { device?: string } {
  const match = /^devices\[(\d+)\]/.exec(path);
  if (!match) return {};
  const name = (devices[Number(match[1])] as { name?: unknown } | undefined)
    ?.name;
  return typeof name === 'string' && name ? { device: name } : {};
}

/** A class-validator angol alapüzeneteinek magyarítása. */
function translate(key: string, message: string): string {
  switch (key) {
    case 'whitelistValidation':
      return 'ismeretlen mező';
    case 'nestedValidation':
      return 'objektum vagy lista kell';
    case 'isBoolean':
      return 'logikai érték (true vagy false) kell';
    case 'isString':
      return message.startsWith('a ') ? message : 'szöveg kell';
    case 'isArray':
      return message.startsWith('a ') ? message : 'lista kell';
    case 'min':
    case 'max':
    case 'maxLength':
    case 'arrayMaxSize':
      return message
        .replace(/^.* must not be less than (\S+)$/, 'legalább $1')
        .replace(/^.* must not be greater than (\S+)$/, 'legfeljebb $1')
        .replace(
          /^.* must be shorter than or equal to (\d+) characters$/,
          'legfeljebb $1 karakter',
        )
        .replace(
          /^.* must contain no more than (\d+) elements$/,
          'legfeljebb $1 elem',
        );
    default:
      return message;
  }
}
