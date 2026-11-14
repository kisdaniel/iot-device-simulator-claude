import {
  HOMEASSISTANT_CONFIG_FILE,
  type HomeAssistantConfigResult,
} from '@iot-sim/shared';
import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SimulationService } from '../simulation/simulation.service.js';
import { buildHomeAssistantCompose } from './ha-compose.js';
import { buildHomeAssistantConfig } from './ha-config.js';

/** Igaz, ha a lekérdezési paraméter "true" vagy "1". */
function flag(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

@ApiTags('homeassistant')
@Controller('homeassistant')
export class HomeAssistantController {
  constructor(private readonly simulation: SimulationService) {}

  @Get('config')
  @ApiOperation({
    summary:
      'Home Assistant MQTT-konfiguráció (configuration.yaml) a felvett eszközökből',
  })
  @ApiQuery({
    name: 'ids',
    required: false,
    description: 'Vesszővel elválasztott eszközazonosítók; elhagyva mind',
  })
  @ApiQuery({
    name: 'includeDiscovered',
    required: false,
    description: 'A discoveryvel felvett Tasmota eszközök is',
  })
  config(
    @Query('ids') ids?: string,
    @Query('includeDiscovered') includeDiscovered?: string,
  ): HomeAssistantConfigResult {
    return this.build(ids, includeDiscovered);
  }

  @Get('config.yaml')
  @Header('Content-Type', 'text/yaml; charset=utf-8')
  @Header(
    'Content-Disposition',
    `attachment; filename="${HOMEASSISTANT_CONFIG_FILE}"`,
  )
  @ApiOperation({ summary: 'Ugyanez letölthető YAML-fájlként' })
  configFile(
    @Query('ids') ids?: string,
    @Query('includeDiscovered') includeDiscovered?: string,
  ): string {
    return this.build(ids, includeDiscovered).yaml;
  }

  @Get('docker-compose.yml')
  @Header('Content-Type', 'text/yaml; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="docker-compose.yml"')
  @ApiOperation({
    summary:
      'docker-compose.yml Home Assistanttel és Mosquittóval; a generált konfigurációt csomagként tölti be',
  })
  composeFile(): string {
    return compose();
  }

  private build(
    ids: string | undefined,
    includeDiscovered: string | undefined,
  ) {
    const wanted = ids ? new Set(ids.split(',').map((id) => id.trim())) : null;
    const devices = this.simulation
      .list()
      .filter((d) => !wanted || wanted.has(d.id))
      .map(({ status: _status, ...device }) => device);
    return {
      ...buildHomeAssistantConfig(devices, {
        includeDiscovered: flag(includeDiscovered),
      }),
      compose: compose(),
    };
  }
}

/** A compose a szerver időzónáját kapja alapértéknek (a TZ változóval felülírható). */
function compose(): string {
  return buildHomeAssistantCompose({
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}
