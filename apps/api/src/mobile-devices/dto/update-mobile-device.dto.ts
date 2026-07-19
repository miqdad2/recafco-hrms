import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Admin metadata-only update. Deliberately has no `status`/`isPrimary`/`approvedAt`/
 * `blockedAt` fields — combined with the global ValidationPipe's `forbidNonWhitelisted`,
 * attempting to set those via this endpoint is rejected with a 400, not silently ignored.
 * Security-status transitions must go through /approve, /block, or /reset.
 */
export class UpdateMobileDeviceDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  manufacturer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  osVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  appVersion?: string;
}
