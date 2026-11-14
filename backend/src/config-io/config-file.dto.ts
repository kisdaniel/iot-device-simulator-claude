import {
  CONFIG_FILE_VERSION,
  type DeviceType,
  SHELLY_ADDON_MAX_SENSORS,
  SHELLY_GENERATIONS,
  type ShellyGeneration,
  TASMOTA_MAX_RELAYS,
  TASMOTA_MAX_SENSORS,
  TASMOTA_TELEPERIOD_MAX,
  TASMOTA_TELEPERIOD_MIN,
  TEMPERATURE_MAX_C,
  TEMPERATURE_MIN_C,
  type TemperatureError,
} from '@iot-sim/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
import {
  DEVICE_TYPES,
  FULL_TOPIC,
  FULL_TOPIC_MESSAGE,
  TASMOTA_TOPIC,
  TASMOTA_TOPIC_MESSAGE,
  TOPIC_PREFIX,
  TOPIC_PREFIX_MESSAGE,
} from '../devices/devices.dto.js';

/** Egy fájlban legfeljebb ennyi eszköz lehet; védi a szervert a túl nagy fájltól. */
export const MAX_IMPORT_DEVICES = 500;

/**
 * A JSON konfigurációs fájl validációja. A mezők a `ConfigFile` típust követik
 * (@iot-sim/shared); az ismeretlen mezőket a validálás hibának veszi, hogy az
 * elgépelés ne maradjon észrevétlen.
 */
export class ConfigFileMeterDto {
  @IsOptional()
  @IsNumber({}, { message: 'a terhelés szám (W)' })
  @Min(0)
  @Max(10_000)
  loadPower?: number;

  @IsOptional()
  @IsNumber({}, { message: 'a feszültség szám (V)' })
  @Min(0)
  @Max(300)
  voltage?: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({}, { message: 'az áramerősség szám (A) vagy null' })
  @Min(0)
  @Max(100)
  currentOverride?: number | null;

  @IsOptional()
  @IsNumber({}, { message: 'a teljesítménytényező szám' })
  @Min(0)
  @Max(1)
  powerFactor?: number;

  @IsOptional()
  @IsNumber({}, { message: 'a frekvencia szám (Hz)' })
  @Min(45)
  @Max(65)
  frequency?: number;

  @IsOptional()
  @IsNumber({}, { message: 'a számláló értéke szám (Wh)' })
  @Min(0)
  @Max(1e12)
  energyTotalWh?: number;

  @IsOptional()
  @IsNumber({}, { message: 'a mai energia szám (Wh)' })
  @Min(0)
  @Max(1e12)
  energyTodayWh?: number;

  @IsOptional()
  @IsNumber({}, { message: 'a tegnapi energia szám (Wh)' })
  @Min(0)
  @Max(1e12)
  energyYesterdayWh?: number;
}

export class ConfigFileSwitchDto {
  @IsInt({ message: 'a sorszám nemnegatív egész szám' })
  @Min(0)
  index: number;

  @IsOptional()
  @IsBoolean()
  output?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConfigFileMeterDto)
  meter?: ConfigFileMeterDto;
}

export class ConfigFileSensorDto {
  @IsInt({ message: 'a sorszám nemnegatív egész szám' })
  @Min(0)
  index: number;

  @IsOptional()
  @Matches(/^[0-9a-fA-F]{16}$/, {
    message: 'a DS18B20 címe 16 hexadecimális jegy',
  })
  address?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber({}, { message: 'a hőmérséklet szám (°C) vagy null' })
  @Min(TEMPERATURE_MIN_C)
  @Max(TEMPERATURE_MAX_C)
  tC?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(['read', 'out_of_range'], {
    message: 'a hiba "read", "out_of_range" vagy null',
  })
  error?: TemperatureError | null;
}

export class ConfigFileAddonDto {
  @IsBoolean()
  enabled: boolean;

  @IsInt({ message: 'a hőmérők száma egész szám' })
  @Min(0)
  @Max(SHELLY_ADDON_MAX_SENSORS)
  sensorCount: number;
}

export class ConfigFileShellyDto {
  @IsIn(SHELLY_GENERATIONS, { message: 'a generáció 2, 3 vagy 4 lehet' })
  generation: ShellyGeneration;

  @IsString()
  @IsNotEmpty({ message: 'az eszközazonosító (deviceId) kötelező' })
  deviceId: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsString()
  @MaxLength(128)
  @Matches(TOPIC_PREFIX, { message: TOPIC_PREFIX_MESSAGE })
  topicPrefix?: string | null;

  @IsOptional()
  @IsBoolean()
  rpcNtf?: boolean;

  @IsOptional()
  @IsBoolean()
  statusNtf?: boolean;

  @IsOptional()
  @IsBoolean()
  enableControl?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConfigFileAddonDto)
  addon?: ConfigFileAddonDto;
}

export class ConfigFileTasmotaDto {
  @IsOptional()
  @Matches(/^[0-9a-fA-F]{12}$/, { message: 'a MAC-cím 12 hexadecimális jegy' })
  mac?: string;

  @IsString({ message: 'a topic kötelező' })
  @MaxLength(64)
  @Matches(TASMOTA_TOPIC, { message: TASMOTA_TOPIC_MESSAGE })
  topic: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(FULL_TOPIC, { message: FULL_TOPIC_MESSAGE })
  fullTopic?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(TASMOTA_TOPIC, { message: TASMOTA_TOPIC_MESSAGE })
  groupTopic?: string;

  @IsOptional()
  @IsInt({ message: 'a relék száma egész szám' })
  @Min(1)
  @Max(TASMOTA_MAX_RELAYS)
  relayCount?: number;

  @IsOptional()
  @IsBoolean()
  hasEnergy?: boolean;

  @IsOptional()
  @IsInt({ message: 'a hőmérők száma egész szám' })
  @Min(0)
  @Max(TASMOTA_MAX_SENSORS)
  sensorCount?: number;

  @IsOptional()
  @IsBoolean()
  discovery?: boolean;

  @IsOptional()
  @IsInt({ message: 'a TelePeriod egész szám (mp)' })
  @Min(TASMOTA_TELEPERIOD_MIN)
  @Max(TASMOTA_TELEPERIOD_MAX)
  telePeriod?: number;

  @IsOptional()
  @IsBoolean()
  publishOnChange?: boolean;

  @IsOptional()
  @IsBoolean()
  powerRetain?: boolean;
}

export class ConfigFileDeviceDto {
  @IsString({ message: 'a név kötelező' })
  @IsNotEmpty({ message: 'a név nem lehet üres' })
  @MaxLength(64)
  name: string;

  @IsIn(DEVICE_TYPES, {
    message: `a típus ${DEVICE_TYPES.join(', ')} lehet`,
  })
  type: DeviceType;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ValidateIf((o: ConfigFileDeviceDto) => o.type !== 'tasmota')
  @IsDefined({ message: 'Shelly eszköznél a shelly beállítás kötelező' })
  @ValidateNested()
  @Type(() => ConfigFileShellyDto)
  shelly?: ConfigFileShellyDto;

  @ValidateIf((o: ConfigFileDeviceDto) => o.type === 'tasmota')
  @IsDefined({ message: 'Tasmota eszköznél a tasmota beállítás kötelező' })
  @ValidateNested()
  @Type(() => ConfigFileTasmotaDto)
  tasmota?: ConfigFileTasmotaDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfigFileSwitchDto)
  switches?: ConfigFileSwitchDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfigFileSensorDto)
  sensors?: ConfigFileSensorDto[];
}

export class ConfigFileBrokerDto {
  @IsString()
  @Matches(/^mqtts?:\/\/[^\s/:]+(:\d{1,5})?\/?$/, {
    message: 'a broker címe mqtt://host:port vagy mqtts://host:port alakú',
  })
  url: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(128)
  username?: string | null;
}

export class ConfigFileDto {
  @IsIn([CONFIG_FILE_VERSION], {
    message: `ismeretlen formátumverzió; ez a szimulátor a(z) ${CONFIG_FILE_VERSION}. verziót ismeri`,
  })
  version: typeof CONFIG_FILE_VERSION;

  @IsOptional()
  @IsString()
  exportedAt?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @ValidateNested()
  @Type(() => ConfigFileBrokerDto)
  broker?: ConfigFileBrokerDto | null;

  @IsArray({ message: 'a devices mező kötelező, és lista' })
  @ArrayMaxSize(MAX_IMPORT_DEVICES)
  @ValidateNested({ each: true })
  @Type(() => ConfigFileDeviceDto)
  devices: ConfigFileDeviceDto[];
}
