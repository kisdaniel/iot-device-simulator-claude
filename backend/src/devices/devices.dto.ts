import {
  SHELLY_ADDON_MAX_SENSORS,
  SHELLY_DEVICE_TYPES,
  SHELLY_GENERATIONS,
  type ShellyDeviceType,
  type ShellyGeneration,
  TEMPERATURE_MAX_C,
  TEMPERATURE_MIN_C,
  type TemperatureError,
} from '@iot-sim/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** MQTT topic-előtag: helyettesítő, szóköz és a két végén perjel nélkül. */
const TOPIC_PREFIX = /^(?!\/)[^\s#+]*[^\s#+/]$/;
const TOPIC_PREFIX_MESSAGE =
  'a topic-előtag nem tartalmazhat szóközt, # vagy + jelet, és nem kezdődhet vagy végződhet perjellel';

export class AddonDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ minimum: 0, maximum: SHELLY_ADDON_MAX_SENSORS, example: 1 })
  @IsInt({ message: 'a hőmérők száma egész szám' })
  @Min(0)
  @Max(SHELLY_ADDON_MAX_SENSORS)
  sensorCount: number;
}

export class CreateShellyDto {
  @ApiProperty({ enum: SHELLY_GENERATIONS, example: 3 })
  @IsIn(SHELLY_GENERATIONS, { message: 'a generáció 2, 3 vagy 4 lehet' })
  generation: ShellyGeneration;

  @ApiPropertyOptional({
    example: 'a8032abe54dc',
    description: '12 hex jegy; elhagyva véletlen',
  })
  @IsOptional()
  @Matches(/^[0-9a-fA-F]{12}$/, { message: 'a MAC-cím 12 hexadecimális jegy' })
  mac?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'elhagyva az eszközazonosító',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(TOPIC_PREFIX, { message: TOPIC_PREFIX_MESSAGE })
  topicPrefix?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  rpcNtf?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  statusNtf?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enableControl?: boolean;

  @ApiPropertyOptional({
    type: AddonDto,
    description: 'Add-on DS18B20 hőmérőkkel (1–5)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddonDto)
  addon?: AddonDto;
}

export class CreateDeviceDto {
  @ApiProperty({ example: 'Bojler' })
  @IsString()
  @IsNotEmpty({ message: 'a név nem lehet üres' })
  @MaxLength(64)
  name: string;

  @ApiProperty({ enum: SHELLY_DEVICE_TYPES })
  @IsIn(SHELLY_DEVICE_TYPES, {
    message:
      'a típus shelly-1pm vagy shelly-2pm lehet (a Tasmota egy későbbi lépésben érkezik)',
  })
  type: ShellyDeviceType;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ type: CreateShellyDto })
  @IsDefined({ message: 'a shelly beállítás kötelező' })
  @ValidateNested()
  @Type(() => CreateShellyDto)
  shelly: CreateShellyDto;
}

export class UpdateShellyDto {
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'null vagy üres: az azonosító',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^$|^(?!\/)[^\s#+]*[^\s#+/]$/, { message: TOPIC_PREFIX_MESSAGE })
  topicPrefix?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  rpcNtf?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  statusNtf?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enableControl?: boolean;

  @ApiPropertyOptional({
    type: AddonDto,
    description: 'Add-on DS18B20 hőmérőkkel (1–5)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddonDto)
  addon?: AddonDto;
}

export class UpdateDeviceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'a név nem lehet üres' })
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({ type: UpdateShellyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateShellyDto)
  shelly?: UpdateShellyDto;
}

export class SetSwitchDto {
  @ApiProperty()
  @IsBoolean()
  output: boolean;
}

/** A mérő állítható mezői; csak a megadottak változnak. */
export class SetMeterDto {
  @ApiPropertyOptional({
    description: 'W, a terhelés bekapcsolt kimenetnél',
    example: 1200,
  })
  @IsOptional()
  @IsNumber({}, { message: 'a terhelés szám (W)' })
  @Min(0)
  @Max(10_000)
  loadPower?: number;

  @ApiPropertyOptional({ description: 'V', example: 230 })
  @IsOptional()
  @IsNumber({}, { message: 'a feszültség szám (V)' })
  @Min(0)
  @Max(300)
  voltage?: number;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'A; null: a terhelésből és a feszültségből számolt',
  })
  @IsOptional()
  @IsNumber({}, { message: 'az áramerősség szám (A)' })
  @Min(0)
  @Max(100)
  currentOverride?: number | null;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber({}, { message: 'a teljesítménytényező szám' })
  @Min(0)
  @Max(1)
  powerFactor?: number;

  @ApiPropertyOptional({ description: 'Hz', example: 50 })
  @IsOptional()
  @IsNumber({}, { message: 'a frekvencia szám (Hz)' })
  @Min(45)
  @Max(65)
  frequency?: number;

  @ApiPropertyOptional({ description: 'Wh, a számláló új értéke' })
  @IsOptional()
  @IsNumber({}, { message: 'a számláló értéke szám (Wh)' })
  @Min(0)
  @Max(1e12)
  energyTotalWh?: number;
}

export class SetSensorDto {
  @ApiPropertyOptional({
    description: `°C, ${TEMPERATURE_MIN_C} és ${TEMPERATURE_MAX_C} között, 0,1 fokra kerekítve`,
    example: 21.5,
  })
  @IsOptional()
  @IsNumber({}, { message: 'a hőmérséklet szám (°C)' })
  @Min(TEMPERATURE_MIN_C)
  @Max(TEMPERATURE_MAX_C)
  tC?: number;

  @ApiPropertyOptional({
    enum: ['read', 'out_of_range'],
    nullable: true,
    description: 'Szenzorhiba szimulációja; null: nincs hiba',
  })
  @IsOptional()
  @IsIn(['read', 'out_of_range'])
  error?: TemperatureError | null;
}
