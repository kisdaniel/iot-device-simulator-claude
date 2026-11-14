import {
  type Device,
  SHELLY_ADDON_FIRST_ID,
  SHELLY_MODELS,
  type ShellyDeviceType,
  shellyTopicPrefix,
  tasmotaGroupTopic,
  tasmotaPowerKey,
  tasmotaSensorKey,
  tasmotaTopic,
} from '@iot-sim/shared';

/** Megjelenített típusnév, pl. „Shelly 1PM Gen3”. */
export function typeLabel(device: Pick<Device, 'type' | 'shelly'>): string {
  if (device.type === 'tasmota') return 'Tasmota';
  const generation = device.shelly?.generation ?? 2;
  return SHELLY_MODELS[device.type as ShellyDeviceType][generation].name;
}

export function identity(device: Device): string {
  return device.shelly?.deviceId ?? device.tasmota?.topic ?? '';
}

export function switchLabel(device: Device, index: number): string {
  const noun = device.type === 'tasmota' ? 'Relé' : 'Kimenet';
  return device.switches.length > 1 ? `${noun} ${index + 1}` : noun;
}

/** A kapcsoló azonosítója a protokollban: switch:0, ill. POWER / POWER1. */
export function switchKey(device: Device, index: number): string {
  return device.type === 'tasmota'
    ? tasmotaPowerKey(device.switches.length, index)
    : `switch:${index}`;
}

/** A hőmérő azonosítója a protokollban: temperature:100, ill. DS18B20 / DS18B20-1. */
export function sensorKey(device: Device, index: number): string {
  return device.type === 'tasmota'
    ? tasmotaSensorKey(device.sensors.length, index)
    : `temperature:${SHELLY_ADDON_FIRST_ID + index}`;
}

/** Az eszköz MQTT topicjai a típusa és a beállításai szerint. */
export function deviceTopics(device: Device): TopicRow[] {
  return device.type === 'tasmota' ? tasmotaTopics(device) : shellyTopics(device);
}

/** A Tasmota topicjai: cmnd (be), stat és tele (ki). */
export function tasmotaTopics(device: Device): TopicRow[] {
  const config = device.tasmota;
  if (!config) return [];
  const keys = device.switches.map((s) => tasmotaPowerKey(device.switches.length, s.index));
  const rows: TopicRow[] = [
    {
      topic: tasmotaTopic(config, 'tele', 'LWT'),
      direction: 'ki',
      description: 'Elérhetőség (Online / Offline), megőrzött',
    },
    ...keys.map((key): TopicRow => ({
      topic: tasmotaTopic(config, 'cmnd', key),
      direction: 'be',
      description: 'ON, OFF, TOGGLE, üres: lekérdezés',
    })),
    {
      topic: tasmotaTopic(config, 'cmnd', 'STATUS'),
      direction: 'be',
      description: 'üres, 8, 10, 11',
    },
    {
      topic: tasmotaTopic(config, 'cmnd', 'TELEPERIOD'),
      direction: 'be',
      description: `Jelentési időköz, most ${config.telePeriod} mp`,
    },
    {
      topic: tasmotaGroupTopic(config, '#'),
      direction: 'be',
      description: 'Csoportparancsok minden Tasmota eszköznek',
    },
    {
      topic: tasmotaTopic(config, 'stat', 'RESULT'),
      direction: 'ki',
      description: 'Parancsok eredménye',
    },
    ...keys.map((key): TopicRow => ({
      topic: tasmotaTopic(config, 'stat', key),
      direction: 'ki',
      description: config.powerRetain ? 'Relé állapota, megőrzött' : 'Relé állapota',
    })),
    {
      topic: tasmotaTopic(config, 'tele', 'STATE'),
      direction: 'ki',
      description: `Állapot ${config.telePeriod} mp-enként`,
    },
  ];
  if (config.hasEnergy || device.sensors.length > 0) {
    rows.push({
      topic: tasmotaTopic(config, 'tele', 'SENSOR'),
      direction: 'ki',
      description: [config.hasEnergy ? 'ENERGY' : '', device.sensors.length > 0 ? 'DS18B20' : '']
        .filter(Boolean)
        .join(' és ')
        .concat(config.publishOnChange ? ', változáskor azonnal is' : ''),
    });
  }
  return rows;
}

export interface TopicRow {
  topic: string;
  direction: 'be' | 'ki';
  description: string;
}

/** Az eszköz MQTT topicjai a beállításai szerint. */
export function shellyTopics(device: Device): TopicRow[] {
  const config = device.shelly;
  if (!config) return [];
  const prefix = shellyTopicPrefix(config);
  const rows: TopicRow[] = [
    {
      topic: `${prefix}/online`,
      direction: 'ki',
      description: 'Elérhetőség (true / false), megőrzött',
    },
    { topic: `${config.deviceId}/rpc`, direction: 'be', description: 'RPC kérések' },
  ];
  if (prefix !== config.deviceId) {
    rows.push({ topic: `${prefix}/rpc`, direction: 'be', description: 'RPC kérések az előtagon' });
  }
  rows.push({
    topic: '<src>/rpc',
    direction: 'ki',
    description: 'RPC válaszok a kérés src mezője szerint',
  });
  if (config.rpcNtf) {
    rows.push({
      topic: `${prefix}/events/rpc`,
      direction: 'ki',
      description: 'NotifyStatus értesítések',
    });
  }
  if (config.statusNtf) {
    for (const s of device.switches) {
      rows.push({
        topic: `${prefix}/status/switch:${s.index}`,
        direction: 'ki',
        description: 'A kapcsoló teljes állapota',
      });
    }
  }
  if (config.statusNtf) {
    for (const t of device.sensors) {
      rows.push({
        topic: `${prefix}/status/temperature:${SHELLY_ADDON_FIRST_ID + t.index}`,
        direction: 'ki',
        description: 'Az Add-on hőmérőjének állapota',
      });
    }
  }
  if (config.enableControl) {
    rows.push(
      { topic: `${prefix}/command`, direction: 'be', description: 'status_update, announce' },
      ...device.switches.map((s): TopicRow => ({
        topic: `${prefix}/command/switch:${s.index}`,
        direction: 'be',
        description: 'on, off, toggle, status_update',
      })),
      {
        topic: 'shellies/command',
        direction: 'be',
        description: 'Közös parancstopic minden Shelly eszköznek',
      },
    );
  }
  return rows;
}
