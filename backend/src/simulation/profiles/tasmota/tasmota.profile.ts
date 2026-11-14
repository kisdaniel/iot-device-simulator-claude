import {
  type Device,
  type SwitchState,
  TASMOTA_TELEPERIOD_MAX,
  TASMOTA_TELEPERIOD_MIN,
  tasmotaGroupTopic,
  tasmotaPowerKey,
  tasmotaTopic,
} from '@iot-sim/shared';
import type { DeviceProfile, ProfileContext } from '../../device-profile.js';
import { energyAt, meterActive } from '../../meter.js';
import {
  discoveryConfig,
  discoverySensors,
  discoveryTopics,
} from './tasmota-discovery.js';
import {
  hasSensorData,
  onOff,
  sensorPayload,
  statePayload,
  statTopic,
  statusPayload,
  tasmotaConfig,
  teleTopic,
} from './tasmota-payloads.js';

interface TeleState {
  /** Az utolsó időszakos jelentés ideje (ms). */
  lastTele: number;
  /** A számláló értéke (Wh) az utolsó időszakos jelentéskor: a Period alapja. */
  periodBase: number;
}

/**
 * Tasmota eszköz MQTT-protokollja a `cmnd` / `stat` / `tele` topicokon:
 * relék (POWER), fogyasztásmérő (ENERGY) és DS18B20 hőmérők.
 */
export class TasmotaProfile implements DeviceProfile {
  readonly type = 'tasmota' as const;

  subscriptions(device: Device): string[] {
    const config = tasmotaConfig(device);
    return [
      ...new Set([
        tasmotaTopic(config, 'cmnd', '#'),
        tasmotaGroupTopic(config, '#'),
      ]),
    ];
  }

  onStart(ctx: ProfileContext): void {
    const config = tasmotaConfig(ctx.device);
    const now = new Date();
    ctx.publish(teleTopic(config, 'LWT'), 'Online', { retain: true });
    if (config.discovery) this.publishDiscovery(ctx);
    for (const state of ctx.device.switches) this.publishPower(ctx, state);
    ctx.publish(
      teleTopic(config, 'STATE'),
      statePayload(ctx.device, ctx.startedAt, now),
    );
    const tele = this.teleState(ctx, now);
    if (hasSensorData(ctx.device)) {
      ctx.publish(teleTopic(config, 'SENSOR'), this.sensor(ctx, now, tele));
    }
  }

  /**
   * Bekapcsolt discoverynél a megőrzött felfedezési üzenetek. A Tasmota a
   * csatlakozás után küldi ki őket; lekapcsoláskor megmaradnak.
   */
  private publishDiscovery(ctx: ProfileContext): void {
    const topics = discoveryTopics(ctx.device);
    const now = new Date();
    ctx.publish(topics.config, discoveryConfig(ctx.device), { retain: true });
    ctx.publish(
      topics.sensors,
      discoverySensors(this.sensor(ctx, now, this.teleState(ctx, now))),
      {
        retain: true,
      },
    );
  }

  /** Üres, megőrzött üzenet: a vezérlő eltávolítja az eszközt. */
  private clearDiscovery(ctx: ProfileContext, device: Device): void {
    const topics = discoveryTopics(device);
    ctx.publish(topics.config, '', { retain: true });
    ctx.publish(topics.sensors, '', { retain: true });
  }

  onRemove(ctx: ProfileContext): void {
    if (tasmotaConfig(ctx.device).discovery)
      this.clearDiscovery(ctx, ctx.device);
  }

  /**
   * A discovery ki- és bekapcsolása, valamint a név változása lekapcsolt
   * eszközön is frissíti a megőrzött üzenetet; újraindításkor az onStart már elküldte.
   */
  onReconfigured(
    ctx: ProfileContext,
    before: Device,
    restarted: boolean,
  ): void {
    const now = tasmotaConfig(ctx.device);
    const was = tasmotaConfig(before);
    if (!now.discovery) {
      if (was.discovery) this.clearDiscovery(ctx, before);
      return;
    }
    const started = restarted && ctx.device.enabled;
    if (!started) this.publishDiscovery(ctx);
  }

  onStop(ctx: ProfileContext): void {
    ctx.publish(teleTopic(tasmotaConfig(ctx.device), 'LWT'), 'Offline', {
      retain: true,
    });
  }

  onMessage(ctx: ProfileContext, topic: string, payload: Buffer): void {
    const config = tasmotaConfig(ctx.device);
    const own = tasmotaTopic(config, 'cmnd');
    const group = tasmotaGroupTopic(config);
    const base = topic.startsWith(own)
      ? own
      : topic.startsWith(group)
        ? group
        : null;
    if (base === null) return;
    const command = topic.slice(base.length);
    // A parancs és a tartalom nem érzékeny a kis- és nagybetűre.
    this.execute(ctx, command.toUpperCase(), payload.toString('utf8').trim());
  }

  onSwitchChanged(ctx: ProfileContext, index: number): void {
    const state = ctx.device.switches.find((s) => s.index === index);
    if (!state) return;
    this.publishPower(ctx, state);
    if (
      tasmotaConfig(ctx.device).publishOnChange &&
      ctx.device.switches[0]?.meter
    ) {
      this.publishSensor(ctx, new Date());
    }
  }

  onMeterChanged(ctx: ProfileContext): void {
    if (tasmotaConfig(ctx.device).publishOnChange)
      this.publishSensor(ctx, new Date());
  }

  onSensorChanged(ctx: ProfileContext): void {
    if (tasmotaConfig(ctx.device).publishOnChange)
      this.publishSensor(ctx, new Date());
  }

  /** TelePeriod másodpercenként: tele/STATE és tele/SENSOR. */
  onTick(ctx: ProfileContext, now: Date): void {
    const config = tasmotaConfig(ctx.device);
    const tele = this.teleState(ctx, now);
    if (now.getTime() - tele.lastTele < config.telePeriod * 1000) return;
    ctx.publish(
      teleTopic(config, 'STATE'),
      statePayload(ctx.device, ctx.startedAt, now),
    );
    if (hasSensorData(ctx.device)) {
      ctx.publish(teleTopic(config, 'SENSOR'), this.sensor(ctx, now, tele));
    }
    tele.lastTele = now.getTime();
    tele.periodBase = this.energyTotal(ctx, now);
  }

  private execute(ctx: ProfileContext, command: string, payload: string): void {
    const config = tasmotaConfig(ctx.device);
    const now = new Date();
    const result = (body: object): void => {
      ctx.publish(statTopic(config, 'RESULT'), body);
    };

    const power = /^POWER(\d*)$/.exec(command);
    if (power) {
      const count = ctx.device.switches.length;
      // A sorszám nélküli POWER az első relé.
      const number = power[1] === '' ? 1 : Number(power[1]);
      const state = ctx.device.switches.find((s) => s.index === number - 1);
      if (!state || number < 1 || number > count)
        return result({ Command: 'Unknown' });
      const target = parsePower(payload, state.output);
      if (target === null) return this.publishPower(ctx, state);
      // A kapcsolás értesítése (RESULT és POWERn) az onSwitchChanged-ben megy ki.
      ctx.setSwitch(state.index, target, 'MQTT');
      return;
    }

    switch (command) {
      case 'STATUS':
        return this.status(ctx, payload, now);
      case 'STATE':
        return result(statePayload(ctx.device, ctx.startedAt, now));
      case 'TELEPERIOD': {
        if (payload !== '' && payload !== '?') {
          const value = Number(payload);
          if (!Number.isFinite(value)) return result({ Command: 'Error' });
          config.telePeriod = Math.min(
            TASMOTA_TELEPERIOD_MAX,
            Math.max(TASMOTA_TELEPERIOD_MIN, Math.round(value)),
          );
          ctx.saveConfig();
        }
        return result({ TelePeriod: config.telePeriod });
      }
      default:
        return result({ Command: 'Unknown' });
    }
  }

  private status(ctx: ProfileContext, payload: string, now: Date): void {
    const config = tasmotaConfig(ctx.device);
    const tele = this.teleState(ctx, now);
    switch (payload) {
      case '':
      case '0':
        ctx.publish(statTopic(config, 'STATUS'), statusPayload(ctx.device));
        return;
      case '8':
      case '10':
        ctx.publish(statTopic(config, `STATUS${payload}`), {
          StatusSNS: this.sensor(ctx, now, tele),
        });
        return;
      case '11':
        ctx.publish(statTopic(config, 'STATUS11'), {
          StatusSTS: statePayload(ctx.device, ctx.startedAt, now),
        });
        return;
      default:
        ctx.publish(statTopic(config, 'RESULT'), { Command: 'Unknown' });
    }
  }

  private publishPower(ctx: ProfileContext, state: SwitchState): void {
    const config = tasmotaConfig(ctx.device);
    const key = tasmotaPowerKey(ctx.device.switches.length, state.index);
    ctx.publish(statTopic(config, 'RESULT'), { [key]: onOff(state.output) });
    ctx.publish(statTopic(config, key), onOff(state.output), {
      retain: config.powerRetain,
    });
  }

  /** Azonnali (változás miatti) SENSOR; a Period alapját nem állítja vissza. */
  private publishSensor(ctx: ProfileContext, now: Date): void {
    if (!hasSensorData(ctx.device)) return;
    const config = tasmotaConfig(ctx.device);
    ctx.publish(
      teleTopic(config, 'SENSOR'),
      this.sensor(ctx, now, this.teleState(ctx, now)),
    );
  }

  private sensor(
    ctx: ProfileContext,
    now: Date,
    tele: TeleState,
  ): Record<string, unknown> {
    return sensorPayload(ctx.device, ctx.startedAt, now, tele.periodBase);
  }

  private energyTotal(ctx: ProfileContext, now: Date): number {
    const state = ctx.device.switches[0];
    return state?.meter
      ? energyAt(state, now, meterActive(ctx.device, state)).total
      : 0;
  }

  private teleState(ctx: ProfileContext, now: Date): TeleState {
    let tele = ctx.memory.get('tele') as TeleState | undefined;
    if (!tele) {
      tele = {
        lastTele: now.getTime(),
        periodBase: this.energyTotal(ctx, now),
      };
      ctx.memory.set('tele', tele);
    }
    return tele;
  }
}

/** ON / 1 / TRUE, OFF / 0 / FALSE, TOGGLE / 2; üres, „?” vagy ismeretlen: lekérdezés (null). */
function parsePower(payload: string, current: boolean): boolean | null {
  switch (payload.toUpperCase()) {
    case 'ON':
    case '1':
    case 'TRUE':
      return true;
    case 'OFF':
    case '0':
    case 'FALSE':
      return false;
    case 'TOGGLE':
    case '2':
      return !current;
    default:
      return null;
  }
}
