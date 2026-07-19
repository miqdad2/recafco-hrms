import { IsBoolean, IsOptional } from 'class-validator';

export class ApproveMobileDeviceDto {
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
