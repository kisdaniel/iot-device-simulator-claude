import type { DeviceView, MqttLogEntry } from '@iot-sim/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateDeviceDto,
  SetMeterDto,
  SetSensorDto,
  SetSwitchDto,
  UpdateDeviceDto,
} from './devices.dto.js';
import { DevicesService } from './devices.service.js';

@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @ApiOperation({ summary: 'Eszközök listája állapottal' })
  list(): DeviceView[] {
    return this.devices.list();
  }

  @Post()
  @ApiOperation({
    summary: 'Új eszköz; 409, ha az azonosító vagy a topic-előtag foglalt',
  })
  create(@Body() dto: CreateDeviceDto): Promise<DeviceView> {
    return this.devices.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Egy eszköz' })
  get(@Param('id') id: string): DeviceView {
    return this.devices.get(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Név és konfiguráció; topicváltáskor az eszköz újraindul',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDeviceDto,
  ): Promise<DeviceView> {
    return this.devices.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Nem elérhető üzenet, leiratkozás, majd törlés' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.devices.remove(id);
  }

  @Post(':id/connect')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Eszköz visszakapcsolása: elérhető üzenet és kezdő állapot',
  })
  connect(@Param('id') id: string): Promise<DeviceView> {
    return this.devices.setEnabled(id, true);
  }

  @Post(':id/disconnect')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Eszköz lekapcsolása: nem elérhető üzenet, utána nem küld és nem fogad',
  })
  disconnect(@Param('id') id: string): Promise<DeviceView> {
    return this.devices.setEnabled(id, false);
  }

  @Put(':id/switches/:index')
  @ApiOperation({
    summary: 'Kapcsolás, mintha a fizikai gombot nyomták volna meg',
  })
  setSwitch(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: SetSwitchDto,
  ): DeviceView {
    return this.devices.setSwitch(id, index, dto.output);
  }

  @Post(':id/switches/:index/toggle')
  @HttpCode(200)
  @ApiOperation({ summary: 'Átváltás' })
  toggle(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
  ): DeviceView {
    return this.devices.setSwitch(id, index, 'toggle');
  }

  @Put(':id/switches/:index/meter')
  @ApiOperation({
    summary:
      'Mért értékek (terhelés, feszültség, áram, számláló); csak a megadott mezők változnak',
  })
  setMeter(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: SetMeterDto,
  ): DeviceView {
    return this.devices.setMeter(id, index, dto);
  }

  @Post(':id/switches/:index/meter/reset')
  @HttpCode(200)
  @ApiOperation({ summary: 'Az energiaszámláló nullázása' })
  resetEnergy(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
  ): DeviceView {
    return this.devices.resetEnergy(id, index);
  }

  @Put(':id/sensors/:index')
  @ApiOperation({
    summary: 'Hőmérő értéke (°C) vagy szenzorhiba szimulációja',
  })
  setSensor(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: SetSensorDto,
  ): DeviceView {
    return this.devices.setSensor(id, index, dto);
  }

  @Get(':id/messages')
  @ApiOperation({
    summary: 'Az eszköz utolsó küldött és fogadott MQTT-üzenetei',
  })
  messages(@Param('id') id: string): readonly MqttLogEntry[] {
    return this.devices.messages(id);
  }
}
