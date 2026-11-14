import type { Device } from '@iot-sim/shared';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeviceEntity } from '../storage/entities/device.entity.js';
import { toDevice } from './devices.mapper.js';

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(DeviceEntity)
    private readonly devices: Repository<DeviceEntity>,
  ) {}

  async list(): Promise<Device[]> {
    const rows = await this.devices.find({
      relations: { switches: true, sensors: true },
      order: { createdAt: 'ASC' },
    });
    return rows.map(toDevice);
  }
}
