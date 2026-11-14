import type { HomeAssistantConfigResult } from '@iot-sim/shared';
import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SimulationService } from '../simulation/simulation.service.js';
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
    'attachment; filename="iot-simulator-homeassistant.yaml"',
  )
  @ApiOperation({ summary: 'Ugyanez letölthető YAML-fájlként' })
  configFile(
    @Query('ids') ids?: string,
    @Query('includeDiscovered') includeDiscovered?: string,
  ): string {
    return this.build(ids, includeDiscovered).yaml;
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
    return buildHomeAssistantConfig(devices, {
      includeDiscovered: flag(includeDiscovered),
    });
  }
}
