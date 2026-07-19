import { AttendanceConnectionMode, AttendanceDeviceType } from '@recafco/db';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Permissive: accepts a valid IPv4 address or a LAN-friendly hostname (no TLD required,
// since on-prem devices are commonly addressed as e.g. "biometric-hq" on the local network).
const IP_OR_HOSTNAME_PATTERN =
  /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export class CreateAttendanceDeviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  deviceCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @IsEnum(AttendanceDeviceType)
  deviceType!: AttendanceDeviceType;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  vendor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  serialNumber?: string;

  @IsString()
  @IsNotEmpty()
  workLocationId!: string;

  @IsOptional()
  @IsString()
  @Matches(IP_OR_HOSTNAME_PATTERN, { message: 'ipAddress must be a valid IPv4 address or hostname' })
  ipAddress?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsEnum(AttendanceConnectionMode)
  connectionMode?: AttendanceConnectionMode;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
