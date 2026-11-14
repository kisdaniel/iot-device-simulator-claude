import { readFile } from 'node:fs/promises';
import {
  type ConfigFile,
  type Device,
  type ImportError,
  type ImportMode,
  type ImportSummary,
} from '@iot-sim/shared';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { BrokerService } from '../broker/broker.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { EventBus } from '../events/event-bus.service.js';
import { SimulationService } from '../simulation/simulation.service.js';
import { DeviceStore } from '../storage/device.store.js';
import {
  exportConfig,
  importItem,
  parseConfigFile,
  planImport,
} from './config-plan.js';

/** Hibás konfigurációs fájl: mezőszintű hibalistával. */
export class ConfigImportError extends Error {
  constructor(readonly errors: ImportError[]) {
    super(
      `A konfigurációs fájl hibás:\n${errors
        .map(
          (e) =>
            `  ${e.path || '(fájl)'}${e.device ? ` („${e.device}”)` : ''}: ${e.message}`,
        )
        .join('\n')}`,
    );
    this.name = 'ConfigImportError';
  }
}

/**
 * A JSON konfiguráció importja és exportja. Ugyanez a kód fut az indításkori
 * betöltésnél (CONFIG_FILE) és a REST végpontokon.
 */
@Injectable()
export class ConfigIoService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ConfigIoService.name);
  /** Egyszerre egy import fut, hogy két kérés ne fésülje össze egymást. */
  private running: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly simulation: SimulationService,
    private readonly store: DeviceStore,
    private readonly broker: BrokerService,
    private readonly bus: EventBus,
  ) {}

  /** Indításkori import; hibás fájlnál a hiba leállítja az alkalmazást. */
  async onApplicationBootstrap(): Promise<void> {
    const path = this.config.configFile;
    if (!path) return;
    const mode = this.config.configImportMode;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, 'utf8'));
    } catch (err) {
      throw new Error(
        `A konfigurációs fájl (${path}) nem olvasható: ${(err as Error).message}`,
      );
    }
    const summary = await this.import(raw, mode, false);
    this.logger.log(
      summary.skipped
        ? `Konfiguráció (${path}): kihagyva, mert az adatbázisban már vannak eszközök (seed mód).`
        : `Konfiguráció betöltve (${path}, ${mode}): ${summary.created.length} új, ${summary.updated.length} frissített, ${summary.unchanged.length} változatlan, ${summary.removed.length} törölt eszköz; broker: ${summary.broker}.`,
    );
  }

  async export(includeState: boolean): Promise<ConfigFile> {
    const devices = this.simulation
      .list()
      .map(({ status: _status, ...device }) => device);
    return exportConfig(
      devices,
      await this.broker.exportSettings(),
      includeState,
    );
  }

  /**
   * Import vagy (dryRun) előnézet. Hibás fájlra `ConfigImportError`; ilyenkor
   * semmi nem változik.
   */
  import(
    raw: unknown,
    mode: ImportMode,
    dryRun: boolean,
  ): Promise<ImportSummary> {
    const run = this.running.then(() => this.run(raw, mode, dryRun));
    this.running = run.catch(() => undefined);
    return run;
  }

  private async run(
    raw: unknown,
    mode: ImportMode,
    dryRun: boolean,
  ): Promise<ImportSummary> {
    const parsed = parseConfigFile(raw);
    if (parsed.errors) throw new ConfigImportError(parsed.errors);
    const existing: Device[] = this.simulation
      .list()
      .map(({ status: _status, ...device }) => device);
    const result = planImport(parsed.file, existing, mode);
    if (result.errors) throw new ConfigImportError(result.errors);
    const { plan } = result;

    const summary: ImportSummary = {
      mode,
      applied: false,
      skipped: plan.skipped,
      created: plan.create.map(importItem),
      updated: plan.update.map(importItem),
      unchanged: plan.unchanged.map(importItem),
      removed: plan.remove.map(importItem),
      broker: 'absent',
    };
    if (plan.skipped) return summary;
    if (parsed.file.broker) {
      summary.broker = await this.broker.importSettings(
        parsed.file.broker,
        true,
      );
    }
    if (dryRun) return summary;

    const removeIds = plan.remove.map((d) => d.id);
    const views = await this.simulation.replaceDevices(
      [...plan.update, ...plan.create],
      removeIds,
      () =>
        this.store.applyImport({
          create: plan.create,
          update: plan.update,
          remove: removeIds,
        }),
    );
    for (const id of removeIds) {
      this.bus.emit({ type: 'device.removed', data: { id } });
    }
    for (const view of views) {
      this.bus.emit({ type: 'device.updated', data: view });
    }
    if (parsed.file.broker && summary.broker === 'updated') {
      await this.broker.importSettings(parsed.file.broker, false);
    }
    summary.applied = true;
    return summary;
  }
}

/** A REST válasz: 400 a mezőszintű hibalistával. */
export function importBadRequest(
  error: ConfigImportError,
): BadRequestException {
  return new BadRequestException({
    message: 'A konfigurációs fájl hibás; semmi nem változott.',
    errors: error.errors,
  });
}
