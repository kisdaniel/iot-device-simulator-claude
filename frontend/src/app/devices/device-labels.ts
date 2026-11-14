import {
  type Device,
  SHELLY_ADDON_FIRST_ID,
  SHELLY_MODELS,
  type ShellyDeviceType,
  shellyTopicPrefix,
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
  return device.switches.length > 1 ? `Kimenet ${index + 1}` : 'Kimenet';
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
