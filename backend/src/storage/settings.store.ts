import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SettingEntity } from './entities/setting.entity.js';

/** Kulcs–érték tár a `settings` táblán, JSON értékekkel. */
@Injectable()
export class SettingsStore {
  constructor(
    @InjectRepository(SettingEntity)
    private readonly repository: Repository<SettingEntity>,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const row = await this.repository.findOneBy({ key });
    return row ? (JSON.parse(row.value) as T) : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.repository.save({ key, value: JSON.stringify(value) });
  }
}
