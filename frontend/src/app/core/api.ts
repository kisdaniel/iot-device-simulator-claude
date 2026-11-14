import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  BrokerSettingsView,
  BrokerTestResult,
  CreateDeviceRequest,
  DeviceView,
  MqttLogEntry,
  UpdateDeviceRequest,
} from '@iot-sim/shared';
import { Observable } from 'rxjs';

/** A brokerűrlap törzse; elhagyott jelszó a tárolt jelszót megtartja. */
export interface BrokerSettingsInput {
  host: string;
  port: number;
  tls: boolean;
  username: string | null;
  password?: string | null;
}

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  listDevices(): Observable<DeviceView[]> {
    return this.http.get<DeviceView[]>('/api/devices');
  }

  createDevice(body: CreateDeviceRequest): Observable<DeviceView> {
    return this.http.post<DeviceView>('/api/devices', body);
  }

  updateDevice(id: string, body: UpdateDeviceRequest): Observable<DeviceView> {
    return this.http.patch<DeviceView>(`/api/devices/${id}`, body);
  }

  deleteDevice(id: string): Observable<void> {
    return this.http.delete<void>(`/api/devices/${id}`);
  }

  setEnabled(id: string, enabled: boolean): Observable<DeviceView> {
    return this.http.post<DeviceView>(
      `/api/devices/${id}/${enabled ? 'connect' : 'disconnect'}`,
      {},
    );
  }

  setSwitch(id: string, index: number, output: boolean): Observable<DeviceView> {
    return this.http.put<DeviceView>(`/api/devices/${id}/switches/${index}`, { output });
  }

  messages(id: string): Observable<MqttLogEntry[]> {
    return this.http.get<MqttLogEntry[]>(`/api/devices/${id}/messages`);
  }

  getBroker(): Observable<BrokerSettingsView> {
    return this.http.get<BrokerSettingsView>('/api/broker');
  }

  saveBroker(input: BrokerSettingsInput): Observable<BrokerSettingsView> {
    return this.http.put<BrokerSettingsView>('/api/broker', input);
  }

  testBroker(input: BrokerSettingsInput): Observable<BrokerTestResult> {
    return this.http.post<BrokerTestResult>('/api/broker/test', input);
  }
}

/** Olvasható hibaüzenet egy HTTP-hibából. */
export function errorMessage(err: unknown): string {
  const body = (err as { error?: { message?: string | string[] } })?.error;
  const message = body?.message;
  if (Array.isArray(message)) return message.join('; ');
  if (typeof message === 'string') return message;
  return 'A szerver nem érhető el.';
}
