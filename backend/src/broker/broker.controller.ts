import type { BrokerSettingsView, BrokerTestResult } from '@iot-sim/shared';
import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BrokerSettingsDto } from './broker.dto.js';
import { BrokerService } from './broker.service.js';

@ApiTags('broker')
@Controller('broker')
export class BrokerController {
  constructor(private readonly broker: BrokerService) {}

  @Get()
  @ApiOperation({ summary: 'Brokerbeállítás jelszó nélkül' })
  get(): Promise<BrokerSettingsView> {
    return this.broker.getView();
  }

  @Put()
  @ApiOperation({
    summary: 'Brokerbeállítás mentése; 409, ha környezeti változó adja',
  })
  update(@Body() dto: BrokerSettingsDto): Promise<BrokerSettingsView> {
    return this.broker.update(dto);
  }

  @Post('test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Próbakapcsolat mentés nélkül' })
  test(@Body() dto: BrokerSettingsDto): Promise<BrokerTestResult> {
    return this.broker.test(dto);
  }
}
