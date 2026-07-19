import { MobileDeviceStatus, MobilePlatform } from '@recafco/db';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { parseQueryBoolean } from '../../common/query-boolean.transform';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListMobileDevicesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(MobileDeviceStatus)
  status?: MobileDeviceStatus;

  @IsOptional()
  @IsEnum(MobilePlatform)
  platform?: MobilePlatform;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isPrimary?: boolean;
}
