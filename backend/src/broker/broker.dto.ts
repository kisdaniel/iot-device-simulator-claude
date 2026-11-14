import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class BrokerSettingsDto {
  @ApiProperty({ example: 'localhost' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(253)
  @Matches(/^[^\s/:@]+$/, {
    message: 'a host nem tartalmazhat szóközt, sémát vagy portot',
  })
  host: string;

  @ApiProperty({ example: 1883 })
  @IsInt()
  @Min(1)
  @Max(65535)
  port: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  tls: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string | null;

  /** Elhagyva a tárolt jelszó marad; null vagy üres érték törli. */
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string | null;
}
