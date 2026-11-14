import type { HealthStatus } from '@iot-sim/shared';
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MqttGateway } from '../mqtt/mqtt-gateway.service.js';
import { APP_VERSION } from '../version.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly gateway: MqttGateway) {}

  @Get()
  @ApiOperation({ summary: 'Egészség-ellenőrzés a Docker HEALTHCHECK számára' })
  get(): HealthStatus {
    // A broker elérhetetlensége nem teszi egészségtelenné a folyamatot: a kapcsolat magától helyreáll.
    return {
      status: 'ok',
      version: APP_VERSION,
      mqtt: this.gateway.connection.status,
    };
  }
}
