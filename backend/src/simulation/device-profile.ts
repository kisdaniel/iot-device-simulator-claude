import type { Device, DeviceType } from '@iot-sim/shared';
import type { PublishOptions } from '../mqtt/mqtt-gateway.service.js';

/** Amit egy profil az eszközéről lát és amivel a külvilág felé hat. */
export interface ProfileContext {
  readonly device: Device;
  /** Közzététel a közös kapcsolaton; hamis, ha nincs élő kapcsolat. */
  publish(
    topic: string,
    payload: string | object,
    options?: PublishOptions,
  ): boolean;
}

/**
 * Egy eszköztípus MQTT-protokollja. A topicok és az üzenetformátumok csak itt
 * szerepelnek; új eszköztípushoz új profilt kell írni és regisztrálni.
 */
export interface DeviceProfile {
  readonly type: DeviceType;
  /** A parancstopicok mintái, amelyekre az eszköz feliratkozik. */
  subscriptions(device: Device): string[];
  /** Elérhető üzenet és kezdő állapot; minden (újra)csatlakozás után lefut. */
  onStart(ctx: ProfileContext): void;
  /** Nem elérhető üzenet: a valós eszköz végakaratának (LWT) tartalma. */
  onStop(ctx: ProfileContext): void;
  onMessage(ctx: ProfileContext, topic: string, payload: Buffer): void;
  /** Másodpercenként egyszer, a közös óráról; a profil dönti el, mi esedékes. */
  onTick(ctx: ProfileContext, now: Date): void;
}
