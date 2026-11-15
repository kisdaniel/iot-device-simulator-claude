import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  BrokerSettingsView,
  BrokerTestResult,
  CreateDeviceRequest,
  DeviceView,
  ComposeOptions,
  HomeAssistantComposeResult,
  HomeAssistantConfigResult,
  ImportError,
  ImportMode,
  ImportSummary,
  MqttLogEntry,
  SetSensorRequest,
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

/** A mérő állítható mezői; csak a megadottak változnak. */
export interface MeterInput {
  loadPower?: number;
  voltage?: number;
  currentOverride?: number | null;
  powerFactor?: number;
  frequency?: number;
  energyTotalWh?: number;
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

  setMeter(id: string, index: number, patch: MeterInput): Observable<DeviceView> {
    return this.http.put<DeviceView>(`/api/devices/${id}/switches/${index}/meter`, patch);
  }

  setSensor(id: string, index: number, body: SetSensorRequest): Observable<DeviceView> {
    return this.http.put<DeviceView>(`/api/devices/${id}/sensors/${index}`, body);
  }

  resetEnergy(id: string, index: number): Observable<DeviceView> {
    return this.http.post<DeviceView>(`/api/devices/${id}/switches/${index}/meter/reset`, {});
  }

  /** Import vagy (dryRun) előnézet; hibás fájlnál 400 a mezőszintű hibákkal. */
  importConfig(file: unknown, mode: ImportMode, dryRun: boolean): Observable<ImportSummary> {
    return this.http.post<ImportSummary>('/api/config/import', file, {
      params: { mode, dryRun: String(dryRun) },
    });
  }

  /** A compose a megadott beállításokkal; a jelszó a törzsben megy, nem az URL-ben. */
  homeAssistantCompose(options: ComposeOptions): Observable<HomeAssistantComposeResult> {
    return this.http.post<HomeAssistantComposeResult>('/api/homeassistant/compose', options);
  }

  /** Ugyanez letöltésre, fájlként. */
  homeAssistantComposeFile(options: ComposeOptions): Observable<Blob> {
    return this.http.post('/api/homeassistant/docker-compose.yml', options, {
      responseType: 'blob',
    });
  }

  homeAssistantConfig(
    ids: string[] | null,
    includeDiscovered: boolean,
  ): Observable<HomeAssistantConfigResult> {
    return this.http.get<HomeAssistantConfigResult>('/api/homeassistant/config', {
      params: homeAssistantParams(ids, includeDiscovered),
    });
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

/** A konfiguráció letöltésének címe, állapottal vagy anélkül. */
export function exportConfigUrl(includeState: boolean): string {
  return `/api/config/export?includeState=${includeState}`;
}

/** A hibás importra adott válasz mezőszintű hibái; más hibánál üres lista. */
export function importErrors(err: unknown): ImportError[] {
  const errors = (err as { error?: { errors?: unknown } })?.error?.errors;
  return Array.isArray(errors) ? (errors as ImportError[]) : [];
}

/** A Home Assistant konfiguráció lekérdezési paraméterei; null: minden eszköz. */
export function homeAssistantParams(
  ids: string[] | null,
  includeDiscovered: boolean,
): Record<string, string> {
  return {
    ...(ids ? { ids: ids.join(',') } : {}),
    ...(includeDiscovered ? { includeDiscovered: 'true' } : {}),
  };
}
