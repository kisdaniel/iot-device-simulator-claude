import type { BrokerSettingsView, BrokerTestResult } from '@iot-sim/shared';
import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MqttGateway } from '../mqtt/mqtt-gateway.service.js';
import { BrokerSettingsDto } from './broker.dto.js';
import { BrokerService } from './broker.service.js';

@ApiTags('broker')
@Controller('broker')
export class BrokerController {
  constructor(
    private readonly broker: BrokerService,
    private readonly gateway: MqttGateway,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Brokerbeállítás jelszó nélkül, és a kapcsolat állapota',
  })
  get(): Promise<BrokerSettingsView> {
    return this.view();
  }

  @Put()
  @ApiOperation({
    summary:
      'Brokerbeállítás mentése, a közös kapcsolat újraépül; 409, ha környezeti változó adja',
  })
  async update(@Body() dto: BrokerSettingsDto): Promise<BrokerSettingsView> {
    await this.broker.update(dto);
    return this.view();
  }

  @Post('test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Próbakapcsolat mentés nélkül' })
  test(@Body() dto: BrokerSettingsDto): Promise<BrokerTestResult> {
    return this.broker.test(dto);
  }

  private async view(): Promise<BrokerSettingsView> {
    return {
      ...(await this.broker.getPublicSettings()),
      managedByEnv: this.broker.managedByEnv,
      connection: this.gateway.connection,
    };
  }
}
