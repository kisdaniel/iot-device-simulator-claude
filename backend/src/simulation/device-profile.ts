import type {
  Device,
  DeviceType,
  MeterState,
  SwitchState,
  TemperatureState,
} from '@iot-sim/shared';
import type { PublishOptions } from '../mqtt/mqtt-gateway.service.js';

/** Az állapotváltozás forrása, ahogy a Shelly `source` mezője is jelzi. */
export type ChangeSource = 'init' | 'MQTT' | 'button' | 'timer';

/** A felhasználó által állítható mérőmezők. */
export type MeterPatch = Partial<
  Pick<
    MeterState,
    | 'loadPower'
    | 'voltage'
    | 'currentOverride'
    | 'powerFactor'
    | 'frequency'
    | 'energyTotalWh'
  >
>;

/** A hőmérő állítható mezői. */
export type SensorPatch = Partial<Pick<TemperatureState, 'tC' | 'error'>>;

/** Amit egy profil az eszközéről lát és amivel a külvilág felé hat. */
export interface ProfileContext {
  readonly device: Device;
  /** Az eszköz utolsó indítása (felvétel, visszakapcsolás, a szimulátor indulása). */
  readonly startedAt: Date;
  /** Közzététel a közös kapcsolaton; hamis, ha nincs élő kapcsolat. */
  publish(
    topic: string,
    payload: string | object,
    options?: PublishOptions,
  ): boolean;
  /**
   * Kapcsoló állítása; a változásról a profil `onSwitchChanged` kezelője értesít.
   * Visszaadja a korábbi kimenetet. Nem létező kapcsolóra RangeError.
   */
  setSwitch(index: number, output: boolean, source: ChangeSource): boolean;
  /** Nullázza a kapcsoló energiaszámlálóját; a nullázás előtti értéket adja (Wh). */
  resetEnergy(index: number): number;
  /**
   * Eszközönkénti munkaterület a profil futási adatainak (pl. percenkénti bontás).
   * Nem kerül mentésre; az eszköz újraindításakor kiürül.
   */
  readonly memory: Map<string, unknown>;
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
  /** Egy kapcsoló megváltozott; `before` a változás előtti állapot. Csak elérhető eszközön hívódik. */
  onSwitchChanged(
    ctx: ProfileContext,
    index: number,
    before: SwitchState,
  ): void;
  /** A kapcsoló mérője megváltozott (terhelés, feszültség, számláló); `before` a korábbi állapot. */
  onMeterChanged(ctx: ProfileContext, index: number, before: SwitchState): void;
  /** Egy hőmérő értéke vagy hibaállapota megváltozott; `before` a korábbi állapot. */
  onSensorChanged(
    ctx: ProfileContext,
    index: number,
    before: TemperatureState,
  ): void;
  /** Másodpercenként egyszer, a közös óráról; a profil dönti el, mi esedékes. */
  onTick(ctx: ProfileContext, now: Date): void;
}
