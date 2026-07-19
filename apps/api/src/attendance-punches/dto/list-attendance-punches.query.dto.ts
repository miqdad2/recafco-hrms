import { AttendanceSourceType, PunchType, PunchValidationStatus } from '@recafco/db';
import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListAttendancePunchesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  workLocationId?: string;

  @IsOptional()
  @IsEnum(AttendanceSourceType)
  sourceType?: AttendanceSourceType;

  @IsOptional()
  @IsEnum(PunchType)
  punchType?: PunchType;

  @IsOptional()
  @IsEnum(PunchValidationStatus)
  validationStatus?: PunchValidationStatus;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
