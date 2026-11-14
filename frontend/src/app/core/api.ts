import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { BrokerSettingsView, BrokerTestResult, Device } from '@iot-sim/shared';
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

  listDevices(): Observable<Device[]> {
    return this.http.get<Device[]>('/api/devices');
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
