import { Component, OnInit, inject, signal } from '@angular/core';
import type { Device, DeviceType } from '@iot-sim/shared';
import { Api, errorMessage } from '../core/api';

const TYPE_LABELS: Record<DeviceType, string> = {
  'shelly-1pm': 'Shelly 1PM',
  'shelly-2pm': 'Shelly 2PM',
  tasmota: 'Tasmota',
};

@Component({
  selector: 'app-device-list',
  templateUrl: './device-list.html',
})
export class DeviceList implements OnInit {
  private readonly api = inject(Api);

  protected readonly devices = signal<Device[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.api.listDevices().subscribe({
      next: (devices) => {
        this.devices.set(devices);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err));
        this.loading.set(false);
      },
    });
  }

  protected typeLabel(device: Device): string {
    const generation = device.shelly ? ` Gen${device.shelly.generation}` : '';
    return TYPE_LABELS[device.type] + generation;
  }

  protected identity(device: Device): string {
    return device.shelly?.deviceId ?? device.tasmota?.topic ?? '';
  }
}
