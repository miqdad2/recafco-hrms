import { PunchType } from '@recafco/db';
import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateMobilePunchDto {
  @IsEnum(PunchType)
  punchType!: PunchType;

  @IsISO8601()
  punchTimeSource!: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  gpsAccuracy?: number;

  @IsOptional()
  @IsString()
  workLocationId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  deviceIdentifier!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  wifiSsid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  wifiBssid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  appVersion?: string;

  @IsOptional()
  @IsObject()
  fraudSignals?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  selfieFileId?: string;
}
