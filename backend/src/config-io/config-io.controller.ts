import {
  type ConfigFile,
  IMPORT_MODES,
  type ImportMode,
  type ImportSummary,
} from '@iot-sim/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ConfigImportError,
  ConfigIoService,
  importBadRequest,
} from './config-io.service.js';

/** Igaz, ha a lekérdezési paraméter nincs megadva (alapérték) vagy "true"/"1". */
function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

@ApiTags('config')
@Controller('config')
export class ConfigIoController {
  constructor(private readonly configIo: ConfigIoService) {}

  @Get('export')
  @ApiOperation({
    summary: 'A teljes konfiguráció JSON fájlként; a broker jelszava nélkül',
  })
  @ApiQuery({
    name: 'includeState',
    required: false,
    description:
      'A pillanatnyi állapot (kapcsolók, mérők, hőmérők) is; alapból igen',
  })
  async export(
    @Query('includeState') includeState: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ConfigFile> {
    const file = await this.configIo.export(flag(includeState, true));
    const date = file.exportedAt!.slice(0, 10);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="iot-simulator-config-${date}.json"`,
    );
    return file;
  }

  @Post('import')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Konfiguráció importja; dryRun=true esetén csak ellenőrzés és összesítés, írás nélkül',
  })
  @ApiQuery({ name: 'mode', required: false, enum: IMPORT_MODES })
  @ApiQuery({ name: 'dryRun', required: false })
  @ApiBody({ description: 'A JSON konfiguráció (ConfigFile)' })
  async import(
    @Body() body: unknown,
    @Query('mode') mode: string | undefined,
    @Query('dryRun') dryRun: string | undefined,
  ): Promise<ImportSummary> {
    const chosen = (mode ?? 'merge') as ImportMode;
    if (!IMPORT_MODES.includes(chosen)) {
      throw new BadRequestException(
        `Ismeretlen importmód: ${mode}; lehetséges: ${IMPORT_MODES.join(', ')}.`,
      );
    }
    try {
      return await this.configIo.import(body, chosen, flag(dryRun, false));
    } catch (err) {
      if (err instanceof ConfigImportError) throw importBadRequest(err);
      throw err;
    }
  }
}
