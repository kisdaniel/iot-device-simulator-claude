import {
  type Device,
  type HomeAssistantConfigResult,
  SHELLY_ADDON_FIRST_ID,
  SHELLY_MODELS,
  type ShellyDeviceType,
  shellyTopicPrefix,
  tasmotaPowerKey,
  tasmotaSensorKey,
  tasmotaTopic,
} from '@iot-sim/shared';
import { stringify } from 'yaml';

export interface HaConfigOptions {
  /** A discoveryvel már felvett Tasmota eszközök is kerüljenek bele (duplikálódhatnak). */
  includeDiscovered: boolean;
}

type Entity = Record<string, unknown>;

interface Entities {
  switch: Entity[];
  sensor: Entity[];
}

/** A szimulátor entitásainak egyedi azonosító-előtagja a Home Assistantben. */
const UNIQUE_PREFIX = 'iotsim';

/** Az entitásazonosítóban csak kisbetű, szám és aláhúzás maradhat. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * A kimenet neve az eszközön belül. A Home Assistant az eszköz nevét eléteszi, ezért egy
 * kimenetnél null (az entitás csak az eszköz nevét kapja), többnél „Kimenet 1”, „Relé 2”.
 */
function outputName(
  device: Device,
  index: number,
  kind: 'Kimenet' | 'Relé',
): string | null {
  return device.switches.length > 1 ? `${kind} ${index + 1}` : null;
}

/** A mért érték neve az eszközön belül: „Teljesítmény”, vagy „Kimenet 2 teljesítmény”. */
function measurementName(output: string | null, label: string): string {
  return output
    ? `${output} ${label}`
    : label.charAt(0).toUpperCase() + label.slice(1);
}

interface SensorSpec {
  key: string;
  label: string;
  unit: string;
  deviceClass: string;
  stateClass: 'measurement' | 'total_increasing';
  template: string;
}

/**
 * A szimulált eszközökből a Home Assistant MQTT-integrációjának YAML-konfigurációja
 * (configuration.yaml, `mqtt:` kulcs). Shellyhez MQTT-n ez az egyetlen út, mert a
 * Home Assistant Shelly integrációja HTTP-n és CoIoT-n beszél, MQTT-n nem.
 */
export function buildHomeAssistantConfig(
  devices: readonly Device[],
  options: HaConfigOptions,
): HomeAssistantConfigResult {
  const entities: Entities = { switch: [], sensor: [] };
  const warnings: string[] = [];
  let deviceCount = 0;

  for (const device of devices) {
    if (device.tasmota?.discovery && !options.includeDiscovered) {
      warnings.push(
        `${device.name}: kimaradt, mert a Tasmota discovery be van kapcsolva, így a Home Assistant magától felveszi.`,
      );
      continue;
    }
    if (device.shelly) addShelly(device, entities, warnings);
    else if (device.tasmota) addTasmota(device, entities);
    else continue;
    deviceCount++;
    if (!device.enabled) {
      warnings.push(
        `${device.name}: le van kapcsolva, a Home Assistantben nem elérhetőként jelenik meg.`,
      );
    }
  }

  const mqtt: Record<string, Entity[]> = {};
  if (entities.switch.length > 0) mqtt.switch = entities.switch;
  if (entities.sensor.length > 0) mqtt.sensor = entities.sensor;
  const entityCount = entities.switch.length + entities.sensor.length;

  const header = [
    '# Home Assistant MQTT-konfiguráció az IoT szimulátor eszközeihez.',
    `# Generálva: ${new Date().toISOString()}; ${deviceCount} eszköz, ${entityCount} entitás.`,
    '# Másold a configuration.yaml-ba (ha már van mqtt: kulcs, a listákat fűzd hozzá),',
    '# majd töltsd újra az MQTT-entitásokat vagy indítsd újra a Home Assistantet.',
    '',
  ].join('\n');
  // A Home Assistant YAML 1.1-et olvas: ott az idézőjel nélküli on/off/ON/OFF
  // logikai érték lenne, ezért 1.1 szerint írjuk ki. Horgonyok nélkül, olvashatóan.
  const body =
    entityCount > 0
      ? stringify(
          { mqtt },
          { version: '1.1', lineWidth: 0, aliasDuplicateObjects: false },
        )
      : 'mqtt: {}\n';
  return { yaml: header + body, deviceCount, entityCount, warnings };
}

function addShelly(
  device: Device,
  entities: Entities,
  warnings: string[],
): void {
  const config = device.shelly!;
  const prefix = shellyTopicPrefix(config);
  const model =
    SHELLY_MODELS[device.type as ShellyDeviceType][config.generation];
  const deviceBlock = {
    identifiers: [config.deviceId],
    name: device.name,
    manufacturer: 'Shelly (szimulált)',
    model: `${model.name} (${model.model})`,
  };
  const availability = {
    availability_topic: `${prefix}/online`,
    payload_available: 'true',
    payload_not_available: 'false',
  };
  const id = slug(config.deviceId);

  // Állapot: a status/switch:N topicról, ha az állapotüzenetek be vannak kapcsolva;
  // különben a NotifyStatus értesítésekből, ami csak a változásokat hordozza.
  const stateFor = (component: string, field: string) =>
    config.statusNtf
      ? {
          state_topic: `${prefix}/status/${component}`,
          json: `value_json.${field}`,
        }
      : config.rpcNtf
        ? {
            state_topic: `${prefix}/events/rpc`,
            json: `value_json.params['${component}'].${field}`,
          }
        : null;

  if (!config.statusNtf) {
    warnings.push(
      config.rpcNtf
        ? `${device.name}: az állapotüzenetek ki vannak kapcsolva, ezért az állapot csak a NotifyStatus értesítésekből frissül.`
        : `${device.name}: sem állapotüzenet, sem RPC-értesítés nincs bekapcsolva, ezért a kapcsoló állapota nem követhető, a mért értékek kimaradnak.`,
    );
  }

  for (const state of device.switches) {
    const component = `switch:${state.index}`;
    const source = stateFor(component, 'output');
    const command = config.enableControl
      ? {
          command_topic: `${prefix}/command/${component}`,
          payload_on: 'on',
          payload_off: 'off',
        }
      : {
          command_topic: `${config.deviceId}/rpc`,
          payload_on: rpcSet(state.index, true),
          payload_off: rpcSet(state.index, false),
        };
    const output = outputName(device, state.index, 'Kimenet');
    entities.switch.push({
      name: output,
      unique_id: `${UNIQUE_PREFIX}_${id}_switch_${state.index}`,
      ...command,
      ...(source
        ? {
            state_topic: source.state_topic,
            value_template: guarded(
              source.json,
              `'ON' if ${source.json} else 'OFF'`,
            ),
            state_on: 'ON',
            state_off: 'OFF',
          }
        : { optimistic: true }),
      ...availability,
      device: deviceBlock,
    });

    if (!state.meter) continue;
    const specs: SensorSpec[] = [
      measurement('power', 'teljesítmény', 'W', 'power', 'apower'),
      measurement('voltage', 'feszültség', 'V', 'voltage', 'voltage'),
      measurement('current', 'áramerősség', 'A', 'current', 'current'),
      {
        key: 'energy',
        label: 'energia',
        unit: 'Wh',
        deviceClass: 'energy',
        stateClass: 'total_increasing',
        template: 'aenergy.total',
      },
    ];
    for (const spec of specs) {
      const sensorSource = stateFor(component, spec.template);
      if (!sensorSource) continue;
      entities.sensor.push(
        sensor(
          measurementName(output, spec.label),
          `${UNIQUE_PREFIX}_${id}_${spec.key}_${state.index}`,
          sensorSource.state_topic,
          guarded(sensorSource.json, sensorSource.json),
          spec,
          availability,
          deviceBlock,
        ),
      );
    }
  }

  for (const state of device.sensors) {
    const component = `temperature:${SHELLY_ADDON_FIRST_ID + state.index}`;
    const source = stateFor(component, 'tC');
    if (!source) continue;
    entities.sensor.push(
      sensor(
        `Hőmérő ${state.index + 1}`,
        `${UNIQUE_PREFIX}_${id}_temperature_${state.index}`,
        source.state_topic,
        guarded(source.json, source.json),
        measurement('temperature', 'hőmérséklet', '°C', 'temperature', 'tC'),
        availability,
        deviceBlock,
      ),
    );
  }
}

function addTasmota(device: Device, entities: Entities): void {
  const config = device.tasmota!;
  const deviceBlock = {
    identifiers: [config.mac],
    name: device.name,
    manufacturer: 'Tasmota (szimulált)',
    model: 'Generic',
  };
  const availability = {
    availability_topic: tasmotaTopic(config, 'tele', 'LWT'),
    payload_available: 'Online',
    payload_not_available: 'Offline',
  };
  const id = slug(config.mac);
  const sensorTopic = tasmotaTopic(config, 'tele', 'SENSOR');

  for (const state of device.switches) {
    const key = tasmotaPowerKey(device.switches.length, state.index);
    const output = outputName(device, state.index, 'Relé');
    entities.switch.push({
      name: output,
      unique_id: `${UNIQUE_PREFIX}_${id}_switch_${state.index}`,
      command_topic: tasmotaTopic(config, 'cmnd', key),
      payload_on: 'ON',
      payload_off: 'OFF',
      // A stat/<t>/POWERn tartalma maga az állapot: ON vagy OFF.
      state_topic: tasmotaTopic(config, 'stat', key),
      state_on: 'ON',
      state_off: 'OFF',
      ...availability,
      device: deviceBlock,
    });
  }

  if (config.hasEnergy) {
    const specs: SensorSpec[] = [
      measurement('power', 'teljesítmény', 'W', 'power', 'ENERGY.Power'),
      measurement('voltage', 'feszültség', 'V', 'voltage', 'ENERGY.Voltage'),
      measurement('current', 'áramerősség', 'A', 'current', 'ENERGY.Current'),
      {
        key: 'energy',
        label: 'energia',
        unit: 'kWh',
        deviceClass: 'energy',
        stateClass: 'total_increasing',
        template: 'ENERGY.Total',
      },
      {
        key: 'energy_today',
        label: 'mai energia',
        unit: 'kWh',
        deviceClass: 'energy',
        stateClass: 'total_increasing',
        template: 'ENERGY.Today',
      },
    ];
    for (const spec of specs) {
      entities.sensor.push(
        sensor(
          measurementName(null, spec.label),
          `${UNIQUE_PREFIX}_${id}_${spec.key}`,
          sensorTopic,
          `{{ value_json.${spec.template} }}`,
          spec,
          availability,
          deviceBlock,
        ),
      );
    }
  }

  for (const state of device.sensors) {
    const key = tasmotaSensorKey(device.sensors.length, state.index);
    // A hibás hőmérő kimarad a SENSOR üzenetből: az üres eredményt a Home Assistant
    // figyelmen kívül hagyja, így az érték nem változik.
    entities.sensor.push(
      sensor(
        key,
        `${UNIQUE_PREFIX}_${id}_${slug(key)}`,
        sensorTopic,
        `{{ value_json['${key}'].Temperature if '${key}' in value_json else '' }}`,
        measurement('temperature', 'hőmérséklet', '°C', 'temperature', ''),
        availability,
        deviceBlock,
      ),
    );
  }
}

function measurement(
  key: string,
  label: string,
  unit: string,
  deviceClass: string,
  template: string,
): SensorSpec {
  return { key, label, unit, deviceClass, stateClass: 'measurement', template };
}

function sensor(
  name: string | null,
  uniqueId: string,
  stateTopic: string,
  valueTemplate: string,
  spec: SensorSpec,
  availability: Entity,
  device: Entity,
): Entity {
  return {
    name,
    unique_id: uniqueId,
    state_topic: stateTopic,
    value_template: valueTemplate,
    unit_of_measurement: spec.unit,
    device_class: spec.deviceClass,
    state_class: spec.stateClass,
    ...availability,
    device,
  };
}

/**
 * Jinja-sablon, amely csak akkor ad új értéket, ha az üzenetben van ilyen mező;
 * különben üres szöveget ad, amit a Home Assistant figyelmen kívül hagy (az állapot
 * marad). A NotifyStatus csak a változott mezőket hordozza, ezért kell az ellenőrzés.
 * A `this.state` itt nem jó: amíg nincs érték, „unknown”, és azt a számszenzor hibának veszi.
 */
function guarded(path: string, expression: string): string {
  const parts = path.replace(/^value_json\.?/, '');
  if (!parts.includes("params['")) return `{{ ${expression} }}`;
  const [component, field] = /params\['([^']+)'\]\.(.+)$/.exec(path)!.slice(1);
  return `{% set c = value_json.params['${component}'] if value_json.params is defined and '${component}' in value_json.params else {} %}{{ (${expression}) if '${field.split('.')[0]}' in c else '' }}`;
}

function rpcSet(index: number, on: boolean): string {
  return JSON.stringify({
    id: 1,
    src: 'homeassistant',
    method: 'Switch.Set',
    params: { id: index, on },
  });
}
