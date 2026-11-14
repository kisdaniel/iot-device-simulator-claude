import type { HealthStatus } from '@iot-sim/shared';
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { APP_VERSION } from '../version.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Egészség-ellenőrzés a Docker HEALTHCHECK számára' })
  get(): HealthStatus {
    return { status: 'ok', version: APP_VERSION };
  }
}
