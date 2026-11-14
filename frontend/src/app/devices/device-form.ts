import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  type CreateDeviceRequest,
  type Device,
  type DeviceType,
  defaultTasmotaTopic,
  SHELLY_ADDON_MAX_SENSORS,
  SHELLY_GENERATIONS,
  SHELLY_MODELS,
  SHELLY_SWITCH_COUNT,
  type ShellyDeviceType,
  type ShellyGeneration,
  shellyDeviceId,
  TASMOTA_DEFAULTS,
  TASMOTA_MAX_RELAYS,
  TASMOTA_MAX_SENSORS,
  TASMOTA_TELEPERIOD_MAX,
  TASMOTA_TELEPERIOD_MIN,
  type UpdateDeviceRequest,
} from '@iot-sim/shared';
import { Api, errorMessage } from '../core/api';
import { DeviceStore } from '../core/device-store';
import { deviceTopics } from './device-labels';

/** Shelly topic-előtag: helyettesítő, szóköz és a két végén perjel nélkül (üres is lehet). */
const TOPIC_PREFIX = /^$|^(?!\/)[^\s#+]*[^\s#+/]$/;
/** Tasmota topic és csoporttopic: perjel, helyettesítő és szóköz nélkül (üres: alapérték). */
const TASMOTA_TOPIC = /^$|^[^\s#+/]+$/;
/** FullTopic: a %prefix% és a %topic% jelölő is kell. */
const FULL_TOPIC = /^(?=.*%prefix%)(?=.*%topic%)[^\s#+]+$/;
const MAC = /^[0-9a-fA-F]{12}$/;

function randomMac(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Új eszköz felvétele (/devices/new) és meglévő szerkesztése (/devices/:id/edit). */
@Component({
  selector: 'app-device-form',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './device-form.html',
})
export class DeviceForm {
  private readonly api = inject(Api);
  private readonly store = inject(DeviceStore);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  /** Az útvonal paramétere; ha van, szerkesztés. */
  readonly id = input<string>();

  protected readonly generations = SHELLY_GENERATIONS;
  protected readonly addonCounts = range(1, SHELLY_ADDON_MAX_SENSORS);
  protected readonly relayCounts = range(1, TASMOTA_MAX_RELAYS);
  protected readonly tasmotaSensorCounts = range(0, TASMOTA_MAX_SENSORS);
  protected readonly teleMin = TASMOTA_TELEPERIOD_MIN;
  protected readonly teleMax = TASMOTA_TELEPERIOD_MAX;
  protected readonly defaults = TASMOTA_DEFAULTS;

  protected readonly form = this.fb.nonNullable.group({
    type: ['shelly-1pm' as DeviceType],
    name: ['', [Validators.required, Validators.maxLength(64)]],
    mac: [randomMac(), [Validators.required, Validators.pattern(MAC)]],
    enabled: [true],
    shelly: this.fb.nonNullable.group({
      generation: [3 as ShellyGeneration],
      topicPrefix: ['', [Validators.maxLength(128), Validators.pattern(TOPIC_PREFIX)]],
      rpcNtf: [true],
      statusNtf: [true],
      enableControl: [true],
      addonEnabled: [false],
      sensorCount: [1],
    }),
    tasmota: this.fb.nonNullable.group({
      topic: ['', [Validators.maxLength(64), Validators.pattern(TASMOTA_TOPIC)]],
      fullTopic: [
        TASMOTA_DEFAULTS.fullTopic as string,
        [Validators.required, Validators.maxLength(128), Validators.pattern(FULL_TOPIC)],
      ],
      groupTopic: [
        TASMOTA_DEFAULTS.groupTopic as string,
        [Validators.required, Validators.maxLength(64), Validators.pattern(TASMOTA_TOPIC)],
      ],
      relayCount: [1],
      hasEnergy: [true],
      sensorCount: [0],
      telePeriod: [
        TASMOTA_DEFAULTS.telePeriod as number,
        [
          Validators.required,
          Validators.min(TASMOTA_TELEPERIOD_MIN),
          Validators.max(TASMOTA_TELEPERIOD_MAX),
        ],
      ],
      publishOnChange: [TASMOTA_DEFAULTS.publishOnChange as boolean],
      powerRetain: [TASMOTA_DEFAULTS.powerRetain as boolean],
      discovery: [false],
    }),
  });

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  protected readonly editing = computed(() => this.id() !== undefined);
  protected readonly device = computed(() => {
    const id = this.id();
    return id ? this.store.find(id) : undefined;
  });
  protected readonly notFound = computed(
    () => this.editing() && this.store.loaded() && !this.device(),
  );
  protected readonly isTasmota = computed(() => this.raw().type === 'tasmota');

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Az űrlap teljes értéke a letiltott mezőkkel együtt, reaktívan. */
  private readonly raw = computed(() => {
    this.value();
    return this.form.getRawValue();
  });

  /** A beállítások szerint készülő eszköz: ebből jön az előnézet. */
  protected readonly draft = computed((): Device => {
    const v = this.raw();
    const mac = MAC.test(v.mac) ? v.mac : '000000000000';
    if (v.type === 'tasmota') {
      const t = v.tasmota;
      return {
        id: '',
        name: v.name,
        type: 'tasmota',
        enabled: true,
        tasmota: {
          mac: mac.toUpperCase(),
          topic: t.topic.trim() || defaultTasmotaTopic(mac),
          fullTopic: t.fullTopic,
          groupTopic: t.groupTopic,
          relayCount: Number(t.relayCount),
          hasEnergy: t.hasEnergy,
          sensorCount: Number(t.sensorCount),
          discovery: t.discovery,
          telePeriod: Number(t.telePeriod),
          publishOnChange: t.publishOnChange,
          powerRetain: t.powerRetain,
        },
        switches: range(0, Number(t.relayCount) - 1).map((index) => ({
          index,
          output: false,
          source: 'init',
        })),
        sensors: range(0, Number(t.sensorCount) - 1).map((index) => ({
          index,
          address: '',
          tC: null,
          error: null,
        })),
      };
    }
    const s = v.shelly;
    const type = v.type as ShellyDeviceType;
    const sensorCount = s.addonEnabled ? Number(s.sensorCount) : 0;
    return {
      id: '',
      name: v.name,
      type,
      enabled: true,
      shelly: {
        generation: s.generation,
        deviceId: MAC.test(v.mac)
          ? shellyDeviceId(type, s.generation, v.mac)
          : `${SHELLY_MODELS[type][s.generation].idPrefix}-<mac>`,
        topicPrefix: s.topicPrefix.trim() || null,
        rpcNtf: s.rpcNtf,
        statusNtf: s.statusNtf,
        enableControl: s.enableControl,
        addon: { enabled: s.addonEnabled, sensorCount },
      },
      switches: range(0, SHELLY_SWITCH_COUNT[type] - 1).map((index) => ({
        index,
        output: false,
        source: 'init',
      })),
      sensors: range(0, sensorCount - 1).map((index) => ({
        index,
        address: '',
        tC: null,
        error: null,
      })),
    };
  });

  protected readonly preview = computed(() => {
    const device = this.draft();
    return {
      identity: device.shelly?.deviceId ?? device.tasmota?.topic ?? '',
      topics: deviceTopics(device),
    };
  });

  /** Szerkesztéskor jelezzük, ha a mentés újraindítja az eszközt. */
  protected readonly restarts = computed(() => {
    const device = this.device();
    if (!device) return false;
    const draft = this.draft();
    const layout = (d: Device) =>
      JSON.stringify([d.switches.length, d.sensors.length, d.tasmota?.hasEnergy, d.shelly?.addon]);
    return layout(device) !== layout(draft);
  });

  private patched = false;

  constructor() {
    // A típushoz nem tartozó csoport letiltva: így nem számít a validációba.
    effect(() => {
      const tasmota = this.isTasmota();
      const { shelly, tasmota: group } = this.form.controls;
      if (tasmota) {
        shelly.disable({ emitEvent: false });
        group.enable({ emitEvent: false });
      } else {
        group.disable({ emitEvent: false });
        shelly.enable({ emitEvent: false });
        // A generáció az azonosító része: szerkesztéskor nem változhat.
        if (this.editing()) shelly.controls.generation.disable({ emitEvent: false });
      }
    });

    // Szerkesztéskor az űrlap egyszer, a betöltött eszközzel töltődik ki.
    effect(() => {
      const device = this.device();
      if (!device || this.patched) return;
      this.patched = true;
      this.fill(device);
    });
  }

  /** A generáció terméknév a kiválasztott Shelly típussal, pl. „Shelly 1PM Gen3”. */
  protected generationName(generation: ShellyGeneration): string {
    const type = this.raw().type;
    return type === 'tasmota' ? '' : SHELLY_MODELS[type][generation].name;
  }

  protected newMac(): void {
    this.form.controls.mac.setValue(randomMac());
  }

  protected invalid(path: string): boolean {
    const control = this.form.get(path);
    return !!control && control.touched && control.invalid;
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const id = this.id();
    const request = id
      ? this.api.updateDevice(id, this.updateRequest())
      : this.api.createDevice(this.createRequest());

    this.busy.set(true);
    this.error.set(null);
    request.subscribe({
      next: (device) => {
        this.store.upsert(device);
        void this.router.navigate(['/devices', device.id]);
      },
      error: (err) => {
        this.error.set(errorMessage(err));
        this.busy.set(false);
      },
    });
  }

  private createRequest(): CreateDeviceRequest {
    const v = this.form.getRawValue();
    const name = v.name.trim();
    if (v.type === 'tasmota') {
      return {
        name,
        type: 'tasmota',
        enabled: v.enabled,
        tasmota: { mac: v.mac, ...this.tasmotaFields() } as CreateDeviceRequest['tasmota'],
      };
    }
    return {
      name,
      type: v.type,
      enabled: v.enabled,
      shelly: { generation: v.shelly.generation, mac: v.mac, ...this.shellyFields() },
    };
  }

  private updateRequest(): UpdateDeviceRequest {
    const v = this.form.getRawValue();
    const name = v.name.trim();
    return v.type === 'tasmota'
      ? { name, tasmota: this.tasmotaFields() }
      : { name, shelly: this.shellyFields() };
  }

  private shellyFields() {
    const s = this.form.controls.shelly.getRawValue();
    return {
      topicPrefix: s.topicPrefix.trim() || null,
      rpcNtf: s.rpcNtf,
      statusNtf: s.statusNtf,
      enableControl: s.enableControl,
      addon: {
        enabled: s.addonEnabled,
        sensorCount: s.addonEnabled ? Number(s.sensorCount) : 0,
      },
    };
  }

  private tasmotaFields() {
    const t = this.form.controls.tasmota.getRawValue();
    return {
      ...(t.topic.trim() ? { topic: t.topic.trim() } : {}),
      fullTopic: t.fullTopic.trim(),
      groupTopic: t.groupTopic.trim(),
      relayCount: Number(t.relayCount),
      hasEnergy: t.hasEnergy,
      sensorCount: Number(t.sensorCount),
      telePeriod: Number(t.telePeriod),
      publishOnChange: t.publishOnChange,
      powerRetain: t.powerRetain,
      discovery: t.discovery,
    };
  }

  private fill(device: Device): void {
    const common = { type: device.type, name: device.name, enabled: device.enabled };
    if (device.tasmota) {
      const t = device.tasmota;
      this.form.patchValue({
        ...common,
        mac: t.mac.toLowerCase(),
        tasmota: {
          topic: t.topic,
          fullTopic: t.fullTopic,
          groupTopic: t.groupTopic,
          relayCount: t.relayCount,
          hasEnergy: t.hasEnergy,
          sensorCount: t.sensorCount,
          telePeriod: t.telePeriod,
          publishOnChange: t.publishOnChange,
          powerRetain: t.powerRetain,
          discovery: t.discovery,
        },
      });
    } else if (device.shelly) {
      const s = device.shelly;
      this.form.patchValue({
        ...common,
        mac: s.deviceId.split('-').at(-1) ?? '',
        shelly: {
          generation: s.generation,
          topicPrefix: s.topicPrefix ?? '',
          rpcNtf: s.rpcNtf,
          statusNtf: s.statusNtf,
          enableControl: s.enableControl,
          addonEnabled: s.addon.enabled,
          sensorCount: s.addon.enabled ? s.addon.sensorCount : 1,
        },
      });
      this.form.controls.shelly.controls.generation.disable();
    }
    // Az azonosítót meghatározó mezők felvétel után nem változhatnak.
    this.form.controls.type.disable();
    this.form.controls.mac.disable();
    this.form.controls.enabled.disable();
  }
}
