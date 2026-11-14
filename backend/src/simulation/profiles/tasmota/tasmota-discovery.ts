import {
  type Device,
  TASMOTA_MAX_RELAYS,
  tasmotaDiscoveryTopic,
} from '@iot-sim/shared';
import { TASMOTA_VERSION, tasmotaConfig } from './tasmota-payloads.js';

/** A discovery listáinak hossza a Tasmotában (relék, kapcsolók, gombok). */
const SLOTS = TASMOTA_MAX_RELAYS;

/**
 * A Tasmota alapértelmezett hosztneve: <topic>-<a MAC utolsó két bájtja & 0x1FFF>,
 * négy jegyre kiegészítve (pl. tasmota-BE54DC-5340).
 */
export function tasmotaHostname(mac: string): string {
  const suffix = parseInt(mac.slice(-4), 16) & 0x1fff;
  return `tasmota-${mac.slice(-6).toUpperCase()}-${String(suffix).padStart(4, '0')}`;
}

/** Dokumentációs IP-cím (192.0.2.0/24, RFC 5737) a MAC utolsó bájtjából. */
export function simulatedIp(mac: string): string {
  return `192.0.2.${parseInt(mac.slice(-2), 16)}`;
}

/**
 * tasmota/discovery/<MAC>/config. A mezőket egy Tasmota 12 utáni valós eszköz
 * üzenete szerint adjuk meg, a Home Assistant integráció által kötelezőnek vett
 * `so` kulcsokkal (köztük a 82-essel) és a redőnymezőkkel (`sho`, `sht`).
 */
export function discoveryConfig(device: Device): Record<string, unknown> {
  const config = tasmotaConfig(device);
  const relays = device.switches.length;
  const slot = <T>(value: (index: number) => T): T[] =>
    Array.from({ length: SLOTS }, (_, index) => value(index));
  return {
    ip: simulatedIp(config.mac),
    dn: device.name,
    fn: slot((i) =>
      i >= relays ? null : i === 0 ? device.name : `${device.name} ${i + 1}`,
    ),
    hn: tasmotaHostname(config.mac),
    mac: config.mac.toUpperCase(),
    md: 'Generic',
    ty: 0,
    if: 0,
    ofln: 'Offline',
    onln: 'Online',
    state: ['OFF', 'ON', 'TOGGLE', 'HOLD'],
    sw: TASMOTA_VERSION,
    t: config.topic,
    ft: config.fullTopic,
    tp: ['cmnd', 'stat', 'tele'],
    rl: slot((i) => (i < relays ? 1 : 0)),
    swc: slot(() => -1),
    swn: slot(() => null),
    btn: slot(() => 0),
    so: {
      '4': 0,
      '11': 0,
      '13': 0,
      '17': 0,
      '20': 0,
      '30': 0,
      '68': 0,
      '73': 0,
      '82': 0,
      '114': 0,
      '117': 0,
    },
    lk: 0,
    lt_st: 0,
    sho: [0, 0, 0, 0],
    sht: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    ver: 1,
  };
}

/** tasmota/discovery/<MAC>/sensors: a SENSOR üzenet szerkezete, amiből az entitások készülnek. */
export function discoverySensors(
  sensor: Record<string, unknown>,
): Record<string, unknown> {
  return { sn: sensor, ver: 1 };
}

export function discoveryTopics(device: Device): {
  config: string;
  sensors: string;
} {
  const { mac } = tasmotaConfig(device);
  return {
    config: tasmotaDiscoveryTopic(mac, 'config'),
    sensors: tasmotaDiscoveryTopic(mac, 'sensors'),
  };
}
