import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const MONTH_PATTERN = /^(20\d{2})-(0[1-9]|1[0-2])$/;
const ID_PATTERN = /^[a-z0-9]{20,32}$/i;
const MONTH_MESSAGE = 'month must be in YYYY-MM format (2000-01 to 2099-12)';

/** `GET /payroll-attendance/monthly/:employeeId` — one bounded month. */
export class MonthQueryDto {
  @Matches(MONTH_PATTERN, { message: MONTH_MESSAGE })
  month!: string;
}

/** Filters shared by the list and the aggregate summary. */
export class MonthlyAttendanceFilterDto extends MonthQueryDto {
  @IsOptional()
  @Matches(ID_PATTERN, { message: 'employeeId has an invalid format' })
  employeeId?: string;

  @IsOptional()
  @Matches(ID_PATTERN, { message: 'departmentId has an invalid format' })
  departmentId?: string;

  @IsOptional()
  @Matches(ID_PATTERN, { message: 'workLocationId has an invalid format' })
  workLocationId?: string;
}

/** `GET /payroll-attendance/monthly` — paginated, max 100 per page. */
export class MonthlyAttendanceListQueryDto extends MonthlyAttendanceFilterDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
