import {
  type Device,
  type ShellyDeviceType,
  shellyTopicPrefix,
  type SwitchState,
  type TemperatureState,
} from '@iot-sim/shared';
import type { DeviceProfile, ProfileContext } from '../../device-profile.js';
import { energyAt, round } from '../../meter.js';
import {
  addonPeripherals,
  changedFields,
  deviceInfo,
  fullStatus,
  shellyConfig,
  shellyTimestamp,
  switchConfig,
  type ShellyTimer,
  switchStatus,
  temperatureConfig,
  temperatureId,
  temperatureStatus,
} from './shelly-status.js';

const BROADCAST_COMMAND_TOPIC = 'shellies/command';
const BROADCAST_ANNOUNCE_TOPIC = 'shellies/announce';

/** RPC hiba a Shelly hibakódjaival. */
class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

type RpcParams = Record<string, unknown>;

interface RpcFrame {
  id?: unknown;
  src?: unknown;
  method: string;
  params?: unknown;
}

/**
 * Shelly Gen2+ (Gen2, Gen3, Gen4) eszköz MQTT-protokollja: RPC, állapotértesítés
 * és szöveges vezérlés. A három generáció csak azonosítóban és modellkódban tér el.
 */
export class ShellyProfile implements DeviceProfile {
  constructor(readonly type: ShellyDeviceType) {}

  subscriptions(device: Device): string[] {
    const config = shellyConfig(device);
    const prefix = shellyTopicPrefix(config);
    const topics = [`${config.deviceId}/rpc`, `${prefix}/rpc`];
    if (config.enableControl) {
      topics.push(
        `${prefix}/command`,
        `${prefix}/command/+`,
        BROADCAST_COMMAND_TOPIC,
      );
    }
    return [...new Set(topics)];
  }

  onStart(ctx: ProfileContext): void {
    const config = shellyConfig(ctx.device);
    ctx.publish(`${shellyTopicPrefix(config)}/online`, 'true', {
      retain: true,
    });
    if (config.statusNtf) this.publishComponentStatuses(ctx, new Date());
  }

  onStop(ctx: ProfileContext): void {
    ctx.publish(
      `${shellyTopicPrefix(shellyConfig(ctx.device))}/online`,
      'false',
      { retain: true },
    );
  }

  onMessage(ctx: ProfileContext, topic: string, payload: Buffer): void {
    const config = shellyConfig(ctx.device);
    const prefix = shellyTopicPrefix(config);
    const text = payload.toString('utf8').trim();

    if (topic === `${config.deviceId}/rpc` || topic === `${prefix}/rpc`) {
      this.handleRpc(ctx, text);
    } else if (
      topic === `${prefix}/command` ||
      topic === BROADCAST_COMMAND_TOPIC
    ) {
      this.handleCommand(ctx, text);
    } else if (topic.startsWith(`${prefix}/command/`)) {
      this.handleComponentCommand(
        ctx,
        topic.slice(prefix.length + '/command/'.length),
        text,
      );
    }
  }

  /**
   * Minden kapcsolás megszakítja a futó időzítőt, kivéve azt, amelyet éppen ez a
   * parancs indít (`toggle_after`); a lejárt időzítő visszakapcsolása is törli.
   */
  onSwitchChanged(
    ctx: ProfileContext,
    index: number,
    before: SwitchState,
  ): void {
    const timers = timerState(ctx);
    const timerBefore = timers.get(index);
    const arming = ctx.memory.get(ARMING_KEY) as Arming | undefined;
    const next = arming?.index === index ? arming.timer : undefined;
    if (next) timers.set(index, next);
    else timers.delete(index);
    this.notifyChange(ctx, index, before, timerBefore);
  }

  onMeterChanged(
    ctx: ProfileContext,
    index: number,
    before: SwitchState,
  ): void {
    const state = ctx.device.switches.find((s) => s.index === index);
    const minutes = minuteState(ctx);
    const base = minutes.base.get(index);
    if (state && base !== undefined) {
      // Kézi számlálóállítás (nullázás) ne torzítsa a percenkénti bontást.
      const now = new Date();
      minutes.base.set(
        index,
        base + energyAt(state, now).total - energyAt(before, now).total,
      );
    }
    const timer = timerState(ctx).get(index);
    this.notifyChange(ctx, index, before, timer);
  }

  /**
   * A hőmérő minden kézi változásáról értesít. A valós eszköz csak 0,5 °C-nál
   * nagyobb változást jelent; teszteléshez a minden változás hasznosabb.
   */
  onSensorChanged(
    ctx: ProfileContext,
    index: number,
    before: TemperatureState,
  ): void {
    const config = shellyConfig(ctx.device);
    const prefix = shellyTopicPrefix(config);
    const state = ctx.device.sensors.find((s) => s.index === index);
    if (!state) return;
    const after = temperatureStatus(state);
    if (JSON.stringify(after) === JSON.stringify(temperatureStatus(before))) {
      return;
    }
    const component = `temperature:${temperatureId(state)}`;
    if (config.rpcNtf) {
      ctx.publish(`${prefix}/events/rpc`, {
        src: config.deviceId,
        dst: `${prefix}/events`,
        method: 'NotifyStatus',
        params: { ts: shellyTimestamp(new Date()), [component]: after },
      });
    }
    if (config.statusNtf) ctx.publish(`${prefix}/status/${component}`, after);
  }

  /**
   * Minden egész percben: a percenkénti bontás léptetése, majd az energiaszámláló
   * jelentése (NotifyStatus és status/switch:N).
   */
  onTick(ctx: ProfileContext, now: Date): void {
    // A lejárt időzítők visszakapcsolnak (a közös óra másodperces pontosságával).
    // A bejárás közbeni törlés (setSwitch → onSwitchChanged) a Map-en biztonságos.
    for (const [index, timer] of timerState(ctx)) {
      if (now.getTime() >= timer.startedAt + timer.duration * 1000) {
        ctx.setSwitch(index, timer.flipTo, 'timer');
      }
    }

    const minute = Math.floor(now.getTime() / 60_000);
    const minutes = minuteState(ctx);
    if (minutes.current === undefined) {
      minutes.current = minute;
      for (const state of ctx.device.switches) {
        minutes.base.set(state.index, energyAt(state, now).total);
      }
      return;
    }
    if (minute === minutes.current) return;
    minutes.current = minute;

    const config = shellyConfig(ctx.device);
    const prefix = shellyTopicPrefix(config);
    const params: Record<string, unknown> = { ts: shellyTimestamp(now) };
    for (const state of ctx.device.switches) {
      const energy = energyAt(state, now).total;
      const base = minutes.base.get(state.index) ?? energy;
      const history = minutes.byMinute.get(state.index) ?? [0, 0, 0];
      // Az elmúlt perc energiája mWh-ban kerül a lista elejére.
      minutes.byMinute.set(state.index, [
        Math.max(0, (energy - base) * 1000),
        ...history.slice(0, 2),
      ]);
      minutes.base.set(state.index, energy);

      const status = switchStatus(
        state,
        now,
        byMinute(ctx, state.index),
        timerState(ctx).get(state.index),
      );
      params[`switch:${state.index}`] = {
        id: state.index,
        aenergy: status.aenergy,
      };
      if (config.statusNtf) {
        ctx.publish(`${prefix}/status/switch:${state.index}`, status);
      }
    }
    if (config.rpcNtf) {
      ctx.publish(`${prefix}/events/rpc`, {
        src: config.deviceId,
        dst: `${prefix}/events`,
        method: 'NotifyStatus',
        params,
      });
    }
  }

  private notifyChange(
    ctx: ProfileContext,
    index: number,
    before: SwitchState,
    timerBefore: ShellyTimer | undefined,
  ): void {
    const config = shellyConfig(ctx.device);
    const prefix = shellyTopicPrefix(config);
    const state = ctx.device.switches.find((s) => s.index === index);
    if (!state) return;

    const now = new Date();
    const minutes = byMinute(ctx, index);
    const after = switchStatus(state, now, minutes, timerState(ctx).get(index));
    const changed = changedFields(
      switchStatus(before, now, minutes, timerBefore),
      after,
    );
    if (Object.keys(changed).length === 0) return;

    if (config.rpcNtf) {
      ctx.publish(`${prefix}/events/rpc`, {
        src: config.deviceId,
        dst: `${prefix}/events`,
        method: 'NotifyStatus',
        params: {
          ts: shellyTimestamp(now),
          [`switch:${index}`]: { id: index, ...changed },
        },
      });
    }
    if (config.statusNtf)
      ctx.publish(`${prefix}/status/switch:${index}`, after);
  }

  private handleRpc(ctx: ProfileContext, text: string): void {
    const frame = parseFrame(text);
    if (!frame) return; // hibás JSON-ra a valós eszköz sem válaszol

    const { deviceId } = shellyConfig(ctx.device);
    let response: Record<string, unknown>;
    try {
      const result = this.call(ctx, frame.method, asParams(frame.params));
      response = { id: frame.id, src: deviceId, dst: frame.src, result };
    } catch (err) {
      if (!(err instanceof RpcError)) throw err;
      response = {
        id: frame.id,
        src: deviceId,
        dst: frame.src,
        error: { code: err.code, message: err.message },
      };
    }
    if (typeof frame.src === 'string' && frame.src !== '') {
      ctx.publish(`${frame.src}/rpc`, response);
    }
  }

  private call(
    ctx: ProfileContext,
    method: string,
    params: RpcParams,
  ): unknown {
    const now = new Date();
    switch (method.toLowerCase()) {
      case 'switch.set': {
        const state = this.switchParam(ctx, params);
        if (typeof params.on !== 'boolean') {
          throw new RpcError(-103, "Missing required argument 'on'!");
        }
        const toggleAfter = params.toggle_after;
        if (
          toggleAfter !== undefined &&
          (typeof toggleAfter !== 'number' ||
            !Number.isFinite(toggleAfter) ||
            toggleAfter <= 0)
        ) {
          throw new RpcError(-103, "Invalid argument 'toggle_after'!");
        }
        return {
          was_on: setWithTimer(ctx, state.index, params.on, toggleAfter),
        };
      }
      case 'switch.toggle': {
        const state = this.switchParam(ctx, params);
        return { was_on: ctx.setSwitch(state.index, !state.output, 'MQTT') };
      }
      case 'switch.getstatus':
        return this.status(ctx, this.switchParam(ctx, params), now);
      case 'switch.resetcounters': {
        const state = this.switchParam(ctx, params);
        return { aenergy: { total: round(ctx.resetEnergy(state.index), 3) } };
      }
      case 'temperature.getstatus':
        return temperatureStatus(this.sensorParam(ctx, params));
      case 'temperature.getconfig':
        return temperatureConfig(this.sensorParam(ctx, params));
      case 'sensoraddon.getperipherals':
        if (ctx.device.sensors.length === 0) {
          throw new RpcError(404, `No handler for ${method}`);
        }
        return addonPeripherals(ctx.device);
      case 'switch.getconfig':
        return switchConfig(this.switchParam(ctx, params));
      case 'shelly.getstatus':
        return fullStatus(
          ctx.device,
          ctx.startedAt,
          now,
          (index) => byMinute(ctx, index),
          (index) => timerState(ctx).get(index),
        );
      case 'shelly.getdeviceinfo':
        return deviceInfo(ctx.device);
      default:
        throw new RpcError(404, `No handler for ${method}`);
    }
  }

  private status(
    ctx: ProfileContext,
    state: SwitchState,
    now: Date,
  ): Record<string, unknown> {
    return switchStatus(
      state,
      now,
      byMinute(ctx, state.index),
      timerState(ctx).get(state.index),
    );
  }

  private sensorParam(
    ctx: ProfileContext,
    params: RpcParams,
  ): TemperatureState {
    if (params.id === undefined) {
      throw new RpcError(-103, "Missing required argument 'id'!");
    }
    const state = ctx.device.sensors.find(
      (s) => temperatureId(s) === params.id,
    );
    if (!state) {
      throw new RpcError(
        -105,
        `Argument 'id', value ${JSON.stringify(params.id)} not found!`,
      );
    }
    return state;
  }

  private switchParam(ctx: ProfileContext, params: RpcParams): SwitchState {
    if (params.id === undefined)
      throw new RpcError(-103, "Missing required argument 'id'!");
    const state = ctx.device.switches.find((s) => s.index === params.id);
    if (!state) {
      throw new RpcError(
        -105,
        `Argument 'id', value ${JSON.stringify(params.id)} not found!`,
      );
    }
    return state;
  }

  private handleCommand(ctx: ProfileContext, command: string): void {
    const now = new Date();
    const prefix = shellyTopicPrefix(shellyConfig(ctx.device));
    if (command === 'status_update') {
      ctx.publish(
        `${prefix}/status`,
        fullStatus(
          ctx.device,
          ctx.startedAt,
          now,
          (index) => byMinute(ctx, index),
          (index) => timerState(ctx).get(index),
        ),
      );
      this.publishComponentStatuses(ctx, now);
    } else if (command === 'announce') {
      const info = deviceInfo(ctx.device);
      ctx.publish(`${prefix}/announce`, info);
      ctx.publish(BROADCAST_ANNOUNCE_TOPIC, info);
    }
  }

  private handleComponentCommand(
    ctx: ProfileContext,
    component: string,
    command: string,
  ): void {
    const prefix = shellyTopicPrefix(shellyConfig(ctx.device));
    const match = /^switch:(\d+)$/.exec(component);
    const state = match
      ? ctx.device.switches.find((s) => s.index === Number(match[1]))
      : undefined;
    if (!state) return;

    // on,<mp> és off,<mp>: kapcsolás visszakapcsolási időzítővel.
    const timed = /^(on|off),\s*(\d+(?:\.\d+)?)$/.exec(command);
    if (timed && Number(timed[2]) > 0) {
      setWithTimer(ctx, state.index, timed[1] === 'on', Number(timed[2]));
      return;
    }

    switch (command) {
      case 'on':
      case 'off':
        ctx.setSwitch(state.index, command === 'on', 'MQTT');
        return;
      case 'toggle':
        ctx.setSwitch(state.index, !state.output, 'MQTT');
        return;
      case 'status_update':
        ctx.publish(
          `${prefix}/status/${component}`,
          this.status(ctx, state, new Date()),
        );
        return;
      default:
        ctx.publish(
          `${prefix}/error/${component}`,
          `Unsupported command: ${command}`,
        );
    }
  }

  private publishComponentStatuses(ctx: ProfileContext, now: Date): void {
    const prefix = shellyTopicPrefix(shellyConfig(ctx.device));
    for (const state of ctx.device.switches) {
      ctx.publish(
        `${prefix}/status/switch:${state.index}`,
        this.status(ctx, state, now),
      );
    }
    for (const state of ctx.device.sensors) {
      ctx.publish(
        `${prefix}/status/temperature:${temperatureId(state)}`,
        temperatureStatus(state),
      );
    }
  }
}

interface MinuteState {
  /** Az utoljára lezárt perc (Unix-perc); az első óraütés állítja be. */
  current?: number;
  /** A számláló értéke (Wh) a perc elején, kapcsolónként. */
  base: Map<number, number>;
  /** Az utolsó három lezárt perc energiája (mWh), legújabb elöl. */
  byMinute: Map<number, number[]>;
}

/** A memóriakulcs, amely alatt a kapcsolónkénti időzítők élnek. */
const TIMERS_KEY = 'timers';
/** Az éppen végrehajtott, időzítőt indító kapcsolás; az onSwitchChanged ebből tudja, hogy ne törölje. */
const ARMING_KEY = 'arming';

interface Arming {
  index: number;
  timer: ShellyTimer;
}

function timerState(ctx: ProfileContext): Map<number, ShellyTimer> {
  let timers = ctx.memory.get(TIMERS_KEY) as
    Map<number, ShellyTimer> | undefined;
  if (!timers) {
    timers = new Map();
    ctx.memory.set(TIMERS_KEY, timers);
  }
  return timers;
}

/**
 * Kapcsolás MQTT-parancsra, opcionális visszakapcsolási időzítővel. Időzítő nélkül
 * a futó időzítő megszakad; időzítővel az új a régi helyére lép, akkor is, ha a
 * kimenet már a kért állapotban volt. Visszaadja, hogy be volt-e kapcsolva.
 */
function setWithTimer(
  ctx: ProfileContext,
  index: number,
  on: boolean,
  toggleAfter: number | undefined,
): boolean {
  if (toggleAfter === undefined) return ctx.setSwitch(index, on, 'MQTT');
  const arming: Arming = {
    index,
    timer: { startedAt: Date.now(), duration: toggleAfter, flipTo: !on },
  };
  ctx.memory.set(ARMING_KEY, arming);
  try {
    return ctx.setSwitch(index, on, 'MQTT');
  } finally {
    ctx.memory.delete(ARMING_KEY);
  }
}

function minuteState(ctx: ProfileContext): MinuteState {
  let state = ctx.memory.get('minutes') as MinuteState | undefined;
  if (!state) {
    state = { base: new Map(), byMinute: new Map() };
    ctx.memory.set('minutes', state);
  }
  return state;
}

function byMinute(ctx: ProfileContext, index: number): readonly number[] {
  return minuteState(ctx).byMinute.get(index) ?? [0, 0, 0];
}

function parseFrame(text: string): RpcFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const frame = value as Record<string, unknown>;
  if (typeof frame.method !== 'string') return null;
  return frame as unknown as RpcFrame;
}

function asParams(value: unknown): RpcParams {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RpcParams)
    : {};
}
