import type { Device } from '@iot-sim/shared';
import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  deviceColumns,
  toDevice,
  toSensorEntity,
  toSwitchEntity,
} from './device.mapper.js';
import { DeviceEntity } from './entities/device.entity.js';
import { SwitchEntity } from './entities/switch.entity.js';
import { TemperatureSensorEntity } from './entities/temperature-sensor.entity.js';

/** Az eszközök tárolása az SQLite adatbázisban. */
@Injectable()
export class DeviceStore {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(DeviceEntity)
    private readonly devices: Repository<DeviceEntity>,
    @InjectRepository(SwitchEntity)
    private readonly switches: Repository<SwitchEntity>,
    @InjectRepository(TemperatureSensorEntity)
    private readonly sensors: Repository<TemperatureSensorEntity>,
  ) {}

  async list(): Promise<Device[]> {
    const rows = await this.devices.find({
      relations: { switches: true, sensors: true },
      order: { createdAt: 'ASC' },
    });
    return rows.map(toDevice);
  }

  /** Új eszköz a kapcsolóival és szenzoraival együtt, egy tranzakcióban. */
  async insert(device: Device): Promise<void> {
    const now = new Date().toISOString();
    await this.dataSource.transaction(async (manager) => {
      await manager.insert(DeviceEntity, {
        id: device.id,
        ...deviceColumns(device),
        createdAt: now,
        updatedAt: now,
      });
      if (device.switches.length > 0) {
        await manager.insert(
          SwitchEntity,
          device.switches.map((s) => toSwitchEntity(device.id, s)),
        );
      }
      if (device.sensors.length > 0) {
        await manager.insert(
          TemperatureSensorEntity,
          device.sensors.map((s) => toSensorEntity(device.id, s)),
        );
      }
    });
  }

  /** Az eszköz saját oszlopai (név, engedélyezés, konfiguráció). */
  async update(device: Device): Promise<void> {
    await this.devices.update(
      { id: device.id },
      { ...deviceColumns(device), updatedAt: new Date().toISOString() },
    );
  }

  /** A kapcsolók és a hőmérők pillanatnyi állapota (kimenet, mérő, hőmérséklet). */
  async saveState(device: Device): Promise<void> {
    await this.switches.save(
      device.switches.map((s) => toSwitchEntity(device.id, s)),
    );
    if (device.sensors.length > 0) {
      await this.sensors.save(
        device.sensors.map((s) => toSensorEntity(device.id, s)),
      );
    }
  }

  /** Az eszköz sorai és a hőmérők teljes cseréje (pl. az Add-on átállítása után). */
  async updateWithSensors(device: Device): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        DeviceEntity,
        { id: device.id },
        { ...deviceColumns(device), updatedAt: new Date().toISOString() },
      );
      await manager.delete(TemperatureSensorEntity, { deviceId: device.id });
      if (device.sensors.length > 0) {
        await manager.insert(
          TemperatureSensorEntity,
          device.sensors.map((s) => toSensorEntity(device.id, s)),
        );
      }
    });
  }

  /** Törlés; a kapcsolók és a szenzorok a külső kulcs miatt vele együtt törlődnek. */
  async delete(id: string): Promise<void> {
    await this.devices.delete({ id });
  }
}
