import type { ComposeOptions } from '@iot-sim/shared';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Felhasználónév: a Mosquitto jelszófájl `felhasználó:hash` sorai miatt szóköz és `:` nélkül. */
const USERNAME = /^[^\s:]+$/;
/** Jelszó: bármi, csak vezérlőkarakter (pl. sortörés) nem, mert a jelszófájlt elrontaná. */
// Szándékosan vezérlőkaraktert keres: a sortörés elrontaná a jelszófájlt.
// eslint-disable-next-line no-control-regex
const PASSWORD = /^[^\u0000-\u001f\u007f]+$/;
/** Gépnév vagy IP-cím. */
const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$|^\[[0-9A-Fa-f:.]+\]$/;
/** Docker képhivatkozás: [regisztráció[:port]/]név[:címke][@digest]. */
const IMAGE =
  /^[A-Za-z0-9][A-Za-z0-9._\-/]*(:[A-Za-z0-9._-]+)?(@sha256:[0-9a-f]{64})?$/;

export class ComposeAuthDto {
  @IsString()
  @MinLength(1, { message: 'a felhasználónév kötelező' })
  @MaxLength(64)
  @Matches(USERNAME, {
    message: 'a felhasználónév nem tartalmazhat szóközt vagy kettőspontot',
  })
  username: string;

  @IsString()
  @MinLength(1, { message: 'a jelszó kötelező' })
  @MaxLength(128)
  @Matches(PASSWORD, {
    message: 'a jelszó nem tartalmazhat sortörést vagy más vezérlőkaraktert',
  })
  password: string;
}

export class ComposeMosquittoDto {
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @ValidateNested()
  @Type(() => ComposeAuthDto)
  auth?: ComposeAuthDto | null;
}

export class ComposeBrokerDto {
  @IsString()
  @MinLength(1, { message: 'a broker címe kötelező' })
  @MaxLength(253)
  @Matches(HOST, { message: 'a broker címe gépnév vagy IP-cím' })
  host: string;

  @IsInt({ message: 'a port egész szám' })
  @Min(1)
  @Max(65535)
  port: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsString()
  @MaxLength(64)
  @Matches(USERNAME, {
    message: 'a felhasználónév nem tartalmazhat szóközt vagy kettőspontot',
  })
  username?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsString()
  @MaxLength(128)
  @Matches(PASSWORD, {
    message: 'a jelszó nem tartalmazhat sortörést vagy más vezérlőkaraktert',
  })
  password?: string | null;
}

export class ComposeNodeRedDto {
  @IsBoolean()
  enabled: boolean;
}

export class ComposeSimulatorDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @MaxLength(255)
  @Matches(IMAGE, {
    message:
      'a kép neve érvényes Docker képhivatkozás (pl. iot-device-simulator:latest)',
  })
  image: string;

  @IsBoolean()
  seedDevices: boolean;
}

/** A POST /api/homeassistant/compose törzse (ComposeOptions). */
export class ComposeOptionsDto implements ComposeOptions {
  @ValidateNested()
  @Type(() => ComposeMosquittoDto)
  mosquitto: ComposeMosquittoDto;

  @ValidateIf((o: ComposeOptionsDto) => !o.mosquitto?.enabled)
  @IsDefined({
    message: 'generált Mosquitto nélkül a külső broker megadása kötelező',
  })
  @ValidateNested()
  @Type(() => ComposeBrokerDto)
  broker?: ComposeBrokerDto | null;

  @ValidateNested()
  @Type(() => ComposeNodeRedDto)
  nodeRed: ComposeNodeRedDto;

  @ValidateNested()
  @Type(() => ComposeSimulatorDto)
  simulator: ComposeSimulatorDto;
}
