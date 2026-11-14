import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'settings' })
export class SettingEntity {
  @PrimaryColumn({ type: 'text' })
  key: string;

  /** JSON-ként tárolt érték */
  @Column({ type: 'text' })
  value: string;
}
