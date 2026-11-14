import {
  type Device,
  type ShellyDeviceType,
  shellyTopicPrefix,
  type SwitchState,
} from '@iot-sim/shared';
import type { DeviceProfile, ProfileContext } from '../../device-profile.js';
import {
  changedFields,
  deviceInfo,
  fullStatus,
  shellyConfig,
  shellyTimestamp,
  switchConfig,
  switchStatus,
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

  onSwitchChanged(
    ctx: ProfileContext,
    index: number,
    before: SwitchState,
  ): void {
    const config = shellyConfig(ctx.device);
    const prefix = shellyTopicPrefix(config);
    const state = ctx.device.switches.find((s) => s.index === index);
    if (!state) return;

    const now = new Date();
    const after = switchStatus(state, now);
    const changed = changedFields(switchStatus(before, now), after);
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

  onTick(): void {
    // A percenkénti energiajelentés a mérési modellel együtt érkezik.
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
        if (params.toggle_after !== undefined) {
          throw new RpcError(
            -103,
            'toggle_after is not supported by the simulator',
          );
        }
        return { was_on: ctx.setSwitch(state.index, params.on, 'MQTT') };
      }
      case 'switch.toggle': {
        const state = this.switchParam(ctx, params);
        return { was_on: ctx.setSwitch(state.index, !state.output, 'MQTT') };
      }
      case 'switch.getstatus':
        return switchStatus(this.switchParam(ctx, params), now);
      case 'switch.getconfig':
        return switchConfig(this.switchParam(ctx, params));
      case 'shelly.getstatus':
        return fullStatus(ctx.device, ctx.startedAt, now);
      case 'shelly.getdeviceinfo':
        return deviceInfo(ctx.device);
      default:
        throw new RpcError(404, `No handler for ${method}`);
    }
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
        fullStatus(ctx.device, ctx.startedAt, now),
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
          switchStatus(state, new Date()),
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
        switchStatus(state, now),
      );
    }
  }
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
