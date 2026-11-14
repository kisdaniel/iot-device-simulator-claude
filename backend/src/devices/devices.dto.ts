import {
  type DeviceType,
  SHELLY_ADDON_MAX_SENSORS,
  SHELLY_DEVICE_TYPES,
  SHELLY_GENERATIONS,
  type ShellyGeneration,
  TASMOTA_DEFAULTS,
  TASMOTA_MAX_RELAYS,
  TASMOTA_MAX_SENSORS,
  TASMOTA_TELEPERIOD_MAX,
  TASMOTA_TELEPERIOD_MIN,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** MQTT topic-előtag: helyettesítő, szóköz és a két végén perjel nélkül. */
export const TOPIC_PREFIX = /^(?!\/)[^\s#+]*[^\s#+/]$/;
export const TOPIC_PREFIX_MESSAGE =
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

export const DEVICE_TYPES: readonly DeviceType[] = [
  ...SHELLY_DEVICE_TYPES,
  'tasmota',
];

/** Tasmota topic és csoporttopic: perjel, helyettesítő és szóköz nélkül. */
export const TASMOTA_TOPIC = /^[^\s#+/]+$/;
export const TASMOTA_TOPIC_MESSAGE =
  'a topic nem tartalmazhat perjelet, szóközt, # vagy + jelet';
/** FullTopic: a %prefix% és a %topic% jelölő is kell, különben a parancs- és állapottopic összemosódik. */
export const FULL_TOPIC = /^(?=.*%prefix%)(?=.*%topic%)[^\s#+]+$/;
export const FULL_TOPIC_MESSAGE =
  'a FullTopic tartalmazza a %prefix% és a %topic% jelölőt, szóköz, # és + nélkül';

class TasmotaFieldsDto {
  @ApiPropertyOptional({
    example: 'tasmota_BE54DC',
    description: 'elhagyva tasmota_<MAC vége>',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(TASMOTA_TOPIC, { message: TASMOTA_TOPIC_MESSAGE })
  topic?: string;

  @ApiPropertyOptional({ example: TASMOTA_DEFAULTS.fullTopic })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(FULL_TOPIC, { message: FULL_TOPIC_MESSAGE })
  fullTopic?: string;

  @ApiPropertyOptional({ example: TASMOTA_DEFAULTS.groupTopic })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(TASMOTA_TOPIC, { message: TASMOTA_TOPIC_MESSAGE })
  groupTopic?: string;

  @ApiPropertyOptional({ example: TASMOTA_DEFAULTS.telePeriod })
  @IsOptional()
  @IsInt({ message: 'a TelePeriod egész szám (mp)' })
  @Min(TASMOTA_TELEPERIOD_MIN)
  @Max(TASMOTA_TELEPERIOD_MAX)
  telePeriod?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  publishOnChange?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  powerRetain?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'Tasmota discovery: megőrzött felfedezési üzenet a Home Assistant számára',
  })
  @IsOptional()
  @IsBoolean()
  discovery?: boolean;
}

export class CreateTasmotaDto extends TasmotaFieldsDto {
  @ApiPropertyOptional({
    example: 'a8032abe54dc',
    description: '12 hex jegy; elhagyva véletlen',
  })
  @IsOptional()
  @Matches(/^[0-9a-fA-F]{12}$/, { message: 'a MAC-cím 12 hexadecimális jegy' })
  mac?: string;

  @ApiProperty({ minimum: 1, maximum: TASMOTA_MAX_RELAYS, example: 1 })
  @IsInt({ message: 'a relék száma egész szám' })
  @Min(1)
  @Max(TASMOTA_MAX_RELAYS)
  relayCount: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  hasEnergy: boolean;

  @ApiProperty({ minimum: 0, maximum: TASMOTA_MAX_SENSORS, example: 0 })
  @IsInt({ message: 'a hőmérők száma egész szám' })
  @Min(0)
  @Max(TASMOTA_MAX_SENSORS)
  sensorCount: number;
}

export class UpdateTasmotaDto extends TasmotaFieldsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: TASMOTA_MAX_RELAYS })
  @IsOptional()
  @IsInt({ message: 'a relék száma egész szám' })
  @Min(1)
  @Max(TASMOTA_MAX_RELAYS)
  relayCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasEnergy?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: TASMOTA_MAX_SENSORS })
  @IsOptional()
  @IsInt({ message: 'a hőmérők száma egész szám' })
  @Min(0)
  @Max(TASMOTA_MAX_SENSORS)
  sensorCount?: number;
}

export class CreateDeviceDto {
  @ApiProperty({ example: 'Bojler' })
  @IsString()
  @IsNotEmpty({ message: 'a név nem lehet üres' })
  @MaxLength(64)
  name: string;

  @ApiProperty({ enum: DEVICE_TYPES })
  @IsIn(DEVICE_TYPES, {
    message: 'a típus shelly-1pm, shelly-2pm vagy tasmota lehet',
  })
  type: DeviceType;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    type: CreateShellyDto,
    description: 'Shelly típusnál kötelező',
  })
  @ValidateIf((o: CreateDeviceDto) => o.type !== 'tasmota')
  @IsDefined({ message: 'a shelly beállítás kötelező' })
  @ValidateNested()
  @Type(() => CreateShellyDto)
  shelly?: CreateShellyDto;

  @ApiPropertyOptional({
    type: () => CreateTasmotaDto,
    description: 'Tasmota típusnál kötelező',
  })
  @ValidateIf((o: CreateDeviceDto) => o.type === 'tasmota')
  @IsDefined({ message: 'a tasmota beállítás kötelező' })
  @ValidateNested()
  @Type(() => CreateTasmotaDto)
  tasmota?: CreateTasmotaDto;
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

  @ApiPropertyOptional({ type: UpdateTasmotaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateTasmotaDto)
  tasmota?: UpdateTasmotaDto;
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
