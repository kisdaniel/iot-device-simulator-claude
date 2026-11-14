import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import type { BrokerSettingsView, BrokerTestResult } from '@iot-sim/shared';
import { Api, BrokerSettingsInput, errorMessage } from '../core/api';

@Component({
  selector: 'app-broker-settings',
  imports: [ReactiveFormsModule],
  templateUrl: './broker-settings.html',
})
export class BrokerSettings implements OnInit {
  private readonly api = inject(Api);
  private readonly fb = inject(FormBuilder);

  protected readonly form = this.fb.nonNullable.group({
    host: ['', [Validators.required, Validators.pattern(/^[^\s/:@]+$/)]],
    port: [1883, [Validators.required, Validators.min(1), Validators.max(65535)]],
    tls: [false],
    username: [''],
    password: [''],
  });

  protected readonly view = signal<BrokerSettingsView | null>(null);
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly testResult = signal<BrokerTestResult | null>(null);

  ngOnInit(): void {
    this.api.getBroker().subscribe({
      next: (view) => this.apply(view),
      error: (err) => this.error.set(errorMessage(err)),
    });
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.start();
    this.api.saveBroker(this.input()).subscribe({
      next: (view) => {
        this.apply(view);
        this.saved.set(true);
        this.busy.set(false);
      },
      error: (err) => this.fail(err),
    });
  }

  protected test(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.start();
    this.api.testBroker(this.input()).subscribe({
      next: (result) => {
        this.testResult.set(result);
        this.busy.set(false);
      },
      error: (err) => this.fail(err),
    });
  }

  private input(): BrokerSettingsInput {
    const { host, port, tls, username, password } = this.form.getRawValue();
    return {
      host: host.trim(),
      port: Number(port),
      tls,
      username: username.trim() || null,
      // Üresen hagyott jelszómező a tárolt jelszót megtartja.
      ...(password ? { password } : {}),
    };
  }

  private apply(view: BrokerSettingsView): void {
    this.view.set(view);
    this.form.reset({
      host: view.host,
      port: view.port,
      tls: view.tls,
      username: view.username ?? '',
      password: '',
    });
    if (view.managedByEnv) this.form.disable();
  }

  private start(): void {
    this.busy.set(true);
    this.saved.set(false);
    this.error.set(null);
    this.testResult.set(null);
  }

  private fail(err: unknown): void {
    this.error.set(errorMessage(err));
    this.busy.set(false);
  }
}
