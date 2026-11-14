import type { DeviceType } from '@iot-sim/shared';
import { Injectable } from '@nestjs/common';
import type { DeviceProfile } from './device-profile.js';

@Injectable()
export class ProfileRegistry {
  private readonly profiles = new Map<DeviceType, DeviceProfile>();

  register(profile: DeviceProfile): void {
    this.profiles.set(profile.type, profile);
  }

  get(type: DeviceType): DeviceProfile | undefined {
    return this.profiles.get(type);
  }
}
