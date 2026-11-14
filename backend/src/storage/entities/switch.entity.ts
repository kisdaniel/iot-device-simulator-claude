import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from 'typeorm';
import { DeviceEntity } from './device.entity.js';

@Entity({ name: 'switches' })
export class SwitchEntity {
  @PrimaryColumn({ name: 'device_id', type: 'text' })
  deviceId: string;

  @PrimaryColumn({ type: 'integer' })
  idx: number;

  @Column({ type: 'boolean', default: false })
  output: boolean;

  @Column({ type: 'text', default: 'init' })
  source: string;

  // A mérő mezői; mérő nélküli kapcsolónál mind NULL.
  @Column({ name: 'load_power', type: 'real', nullable: true })
  loadPower: number | null;

  @Column({ type: 'real', nullable: true })
  voltage: number | null;

  @Column({ name: 'current_override', type: 'real', nullable: true })
  currentOverride: number | null;

  @Column({ name: 'power_factor', type: 'real', nullable: true })
  powerFactor: number | null;

  @Column({ type: 'real', nullable: true })
  frequency: number | null;

  @Column({ name: 'energy_total_wh', type: 'real', nullable: true })
  energyTotalWh: number | null;

  @Column({ name: 'energy_today_wh', type: 'real', nullable: true })
  energyTodayWh: number | null;

  @Column({ name: 'energy_yesterday_wh', type: 'real', nullable: true })
  energyYesterdayWh: number | null;

  @Column({ name: 'energy_updated_at', type: 'text', nullable: true })
  energyUpdatedAt: string | null;

  @ManyToOne(() => DeviceEntity, (d) => d.switches, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device: Relation<DeviceEntity>;
}
