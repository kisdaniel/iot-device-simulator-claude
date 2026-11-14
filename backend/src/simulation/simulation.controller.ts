import type { MqttLogEntry } from '@iot-sim/shared';
import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SimulationService } from './simulation.service.js';

@ApiTags('devices')
@Controller('devices')
export class SimulationController {
  constructor(private readonly simulation: SimulationService) {}

  @Get(':id/messages')
  @ApiOperation({
    summary: 'Az eszköz utolsó küldött és fogadott MQTT-üzenetei',
  })
  messages(@Param('id') id: string): readonly MqttLogEntry[] {
    const messages = this.simulation.messages(id);
    if (!messages)
      throw new NotFoundException(
        `Nincs futó eszköz ezzel az azonosítóval: ${id}`,
      );
    return messages;
  }
}
