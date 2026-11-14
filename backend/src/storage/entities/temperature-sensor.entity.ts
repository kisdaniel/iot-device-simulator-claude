import type { TemperatureError } from '@iot-sim/shared';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from 'typeorm';
import { DeviceEntity } from './device.entity.js';

@Entity({ name: 'temperature_sensors' })
export class TemperatureSensorEntity {
  @PrimaryColumn({ name: 'device_id', type: 'text' })
  deviceId: string;

  @PrimaryColumn({ type: 'integer' })
  idx: number;

  @Column({ type: 'text' })
  address: string;

  @Column({ type: 'real', nullable: true })
  tc: number | null;

  @Column({ type: 'text', nullable: true })
  error: TemperatureError | null;

  @ManyToOne(() => DeviceEntity, (d) => d.sensors, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device: Relation<DeviceEntity>;
}
