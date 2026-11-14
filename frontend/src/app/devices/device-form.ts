import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  SHELLY_ADDON_MAX_SENSORS,
  SHELLY_GENERATIONS,
  SHELLY_MODELS,
  SHELLY_SWITCH_COUNT,
  type ShellyDeviceType,
  type ShellyGeneration,
  shellyDeviceId,
} from '@iot-sim/shared';
import { Api, errorMessage } from '../core/api';
import { DeviceStore } from '../core/device-store';
import { shellyTopics } from './device-labels';

/** MQTT topic-előtag: helyettesítő, szóköz és a két végén perjel nélkül (üres is lehet). */
const TOPIC_PREFIX = /^$|^(?!\/)[^\s#+]*[^\s#+/]$/;

function randomMac(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
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
  protected readonly sensorCounts = Array.from(
    { length: SHELLY_ADDON_MAX_SENSORS },
    (_, i) => i + 1,
  );
  /** Szerkesztéskor jelezzük, ha az Add-on változása újraindítja az eszközt. */
  protected readonly addonChanged = computed(() => {
    const device = this.device();
    const value = this.value();
    if (!device?.shelly) return false;
    const enabled = value.addonEnabled ?? false;
    const count = enabled ? Number(value.sensorCount) : 0;
    return enabled !== device.shelly.addon.enabled || count !== device.shelly.addon.sensorCount;
  });
  protected readonly models = SHELLY_MODELS;

  protected readonly form = this.fb.nonNullable.group({
    type: ['shelly-1pm' as ShellyDeviceType],
    generation: [3 as ShellyGeneration],
    name: ['', [Validators.required, Validators.maxLength(64)]],
    mac: [randomMac(), [Validators.required, Validators.pattern(/^[0-9a-fA-F]{12}$/)]],
    topicPrefix: ['', [Validators.maxLength(128), Validators.pattern(TOPIC_PREFIX)]],
    rpcNtf: [true],
    statusNtf: [true],
    enableControl: [true],
    enabled: [true],
    addonEnabled: [false],
    sensorCount: [1],
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

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** A létrejövő azonosító és topicok, ahogy az űrlap éppen áll. */
  protected readonly preview = computed(() => {
    const value = { ...this.form.getRawValue(), ...this.value() };
    const valid = /^[0-9a-fA-F]{12}$/.test(value.mac ?? '');
    const deviceId = valid
      ? shellyDeviceId(value.type!, value.generation!, value.mac!)
      : `${SHELLY_MODELS[value.type!][value.generation!].idPrefix}-<mac>`;
    const topics = shellyTopics({
      id: '',
      name: value.name ?? '',
      type: value.type!,
      enabled: true,
      shelly: {
        generation: value.generation!,
        deviceId,
        topicPrefix: value.topicPrefix?.trim() || null,
        rpcNtf: value.rpcNtf!,
        statusNtf: value.statusNtf!,
        enableControl: value.enableControl!,
        addon: {
          enabled: value.addonEnabled!,
          sensorCount: value.addonEnabled ? value.sensorCount! : 0,
        },
      },
      switches: Array.from({ length: SHELLY_SWITCH_COUNT[value.type!] }, (_, index) => ({
        index,
        output: false,
        source: 'init',
      })),
      sensors: Array.from({ length: value.addonEnabled ? value.sensorCount! : 0 }, (_, index) => ({
        index,
        address: '',
        tC: null,
        error: null,
      })),
    });
    return { deviceId, topics };
  });

  private patched = false;

  constructor() {
    // Szerkesztéskor az űrlap egyszer, a betöltött eszközzel töltődik ki.
    effect(() => {
      const device = this.device();
      if (!device?.shelly || this.patched) return;
      this.patched = true;
      this.form.patchValue({
        type: device.type as ShellyDeviceType,
        generation: device.shelly.generation,
        name: device.name,
        mac: device.shelly.deviceId.split('-').at(-1) ?? '',
        topicPrefix: device.shelly.topicPrefix ?? '',
        rpcNtf: device.shelly.rpcNtf,
        statusNtf: device.shelly.statusNtf,
        enableControl: device.shelly.enableControl,
        addonEnabled: device.shelly.addon.enabled,
        sensorCount: device.shelly.addon.enabled ? device.shelly.addon.sensorCount : 1,
        enabled: device.enabled,
      });
      // Az azonosítót meghatározó mezők felvétel után nem változhatnak.
      for (const name of ['type', 'generation', 'mac', 'enabled'] as const) {
        this.form.controls[name].disable();
      }
    });
  }

  protected newMac(): void {
    this.form.controls.mac.setValue(randomMac());
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const topicPrefix = v.topicPrefix.trim() || null;
    const addon = {
      enabled: v.addonEnabled,
      sensorCount: v.addonEnabled ? Number(v.sensorCount) : 0,
    };
    const flags = {
      rpcNtf: v.rpcNtf,
      statusNtf: v.statusNtf,
      enableControl: v.enableControl,
      addon,
    };
    const id = this.id();
    const request = id
      ? this.api.updateDevice(id, { name: v.name.trim(), shelly: { topicPrefix, ...flags } })
      : this.api.createDevice({
          name: v.name.trim(),
          type: v.type,
          enabled: v.enabled,
          shelly: { generation: v.generation, mac: v.mac, topicPrefix, ...flags },
        });

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

  protected invalid(name: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[name];
    return control.touched && control.invalid;
  }
}
