import { AttendanceConnectionMode, AttendanceDeviceType } from '@recafco/db';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { parseQueryBoolean } from '../../common/query-boolean.transform';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListAttendanceDevicesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  workLocationId?: string;

  @IsOptional()
  @IsEnum(AttendanceDeviceType)
  deviceType?: AttendanceDeviceType;

  @IsOptional()
  @IsEnum(AttendanceConnectionMode)
  connectionMode?: AttendanceConnectionMode;
}
