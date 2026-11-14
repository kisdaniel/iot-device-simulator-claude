import { Component, computed, inject, signal } from '@angular/core';
import type { ImportError, ImportMode, ImportSummary } from '@iot-sim/shared';
import { Api, errorMessage, exportConfigUrl, importErrors } from '../core/api';

/** A felületről választható importmódok (a `seed` csak indításkor értelmes). */
type UiImportMode = Extract<ImportMode, 'merge' | 'replace'>;

/**
 * A konfiguráció exportja és importja JSON fájlban. Az import előbb előnézetet kér
 * (dryRun), és csak megerősítés után ír; hibás fájlnál a mezőszintű hibákat mutatja.
 */
@Component({
  selector: 'app-config-transfer',
  templateUrl: './config-transfer.html',
})
export class ConfigTransfer {
  private readonly api = inject(Api);

  protected readonly includeState = signal(true);
  protected readonly exportUrl = computed(() => exportConfigUrl(this.includeState()));

  protected readonly fileName = signal<string | null>(null);
  private readonly content = signal<unknown>(null);
  protected readonly mode = signal<UiImportMode>('merge');
  protected readonly preview = signal<ImportSummary | null>(null);
  protected readonly errors = signal<ImportError[]>([]);
  protected readonly failure = signal<string | null>(null);
  protected readonly result = signal<ImportSummary | null>(null);
  protected readonly busy = signal(false);

  protected readonly typeNames: Record<string, string> = {
    'shelly-1pm': 'Shelly 1PM',
    'shelly-2pm': 'Shelly 2PM',
    tasmota: 'Tasmota',
  };

  /** Van-e mit beírni: új, frissülő vagy törlődő eszköz, vagy brokerváltozás. */
  protected readonly hasChanges = computed(() => {
    const p = this.preview();
    return Boolean(
      p && (p.created.length || p.updated.length || p.removed.length || p.broker === 'updated'),
    );
  });

  protected setIncludeState(event: Event): void {
    this.includeState.set((event.target as HTMLInputElement).checked);
  }

  protected async choose(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.reset();
    if (!file) return;
    this.fileName.set(file.name);
    try {
      this.content.set(JSON.parse(await file.text()));
    } catch {
      this.failure.set('A fájl nem érvényes JSON.');
      return;
    }
    this.check();
  }

  protected setMode(mode: UiImportMode): void {
    this.mode.set(mode);
    this.result.set(null);
    if (this.content() !== null) this.check();
  }

  /** Előnézet: mi történne, írás nélkül. */
  private check(): void {
    this.run(true, (summary) => this.preview.set(summary));
  }

  protected apply(): void {
    this.run(false, (summary) => {
      this.result.set(summary);
      this.preview.set(null);
      this.content.set(null);
      this.fileName.set(null);
    });
  }

  private run(dryRun: boolean, done: (summary: ImportSummary) => void): void {
    this.busy.set(true);
    this.errors.set([]);
    this.failure.set(null);
    this.api.importConfig(this.content(), this.mode(), dryRun).subscribe({
      next: (summary) => {
        this.busy.set(false);
        done(summary);
      },
      error: (err) => {
        this.busy.set(false);
        this.preview.set(null);
        const errors = importErrors(err);
        this.errors.set(errors);
        this.failure.set(errorMessage(err));
      },
    });
  }

  private reset(): void {
    this.fileName.set(null);
    this.content.set(null);
    this.preview.set(null);
    this.errors.set([]);
    this.failure.set(null);
    this.result.set(null);
  }
}
