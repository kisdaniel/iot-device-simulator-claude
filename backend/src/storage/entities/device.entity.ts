import type { DeviceType } from '@iot-sim/shared';
import {
  Column,
  Entity,
  OneToMany,
  PrimaryColumn,
  type Relation,
} from 'typeorm';
import { SwitchEntity } from './switch.entity.js';
import { TemperatureSensorEntity } from './temperature-sensor.entity.js';

@Entity({ name: 'devices' })
export class DeviceEntity {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  type: DeviceType;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /** ShellyConfig vagy TasmotaConfig JSON-ként */
  @Column({ type: 'text' })
  config: string;

  /** A Shelly deviceId, ill. a Tasmota topic: eszközök között egyedi */
  @Column({ name: 'identity', type: 'text', unique: true })
  identity: string;

  @Column({ name: 'created_at', type: 'text' })
  createdAt: string;

  @Column({ name: 'updated_at', type: 'text' })
  updatedAt: string;

  @OneToMany(() => SwitchEntity, (s) => s.device, { cascade: true })
  switches: Relation<SwitchEntity[]>;

  @OneToMany(() => TemperatureSensorEntity, (s) => s.device, { cascade: true })
  sensors: Relation<TemperatureSensorEntity[]>;
}
