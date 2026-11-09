import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CalendarAssignmentScope, CalendarDayType, CalendarPolicyStatus } from '@recafco/db';

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DATE_MSG = 'must be a date in YYYY-MM-DD format';
const ID = /^[a-z0-9]{20,32}$/i;
const MONTH = /^(20\d{2})-(0[1-9]|1[0-2])$/;

export class CreateWorkCalendarDto {
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,39}$/, { message: 'code must be 2–40 characters: capital letters, digits, "-" or "_"' })
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** Kuwait weekdays that are working days: 0 = Sunday … 6 = Saturday. May be empty. */
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingWeekdays!: number[];
}

export class UpdateWorkCalendarDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingWeekdays?: number[];
}

/** Activation records WHO approved and WHICH HR decision authorises it. */
export class ActivateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  approvalReference!: string;
}

export class DeactivateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class MonthQueryDto {
  @Matches(MONTH, { message: 'month must be in YYYY-MM format (2000-01 to 2099-12)' })
  month!: string;
}

export class CreateAssignmentDto {
  @Matches(ID, { message: 'calendarId has an invalid format' })
  calendarId!: string;

  @IsEnum(CalendarAssignmentScope)
  scope!: CalendarAssignmentScope;

  /** EMPLOYEE scope: exactly one of employeeId or workLocationId (bulk: every employee currently at that location). */
  @IsOptional()
  @Matches(ID, { message: 'employeeId has an invalid format' })
  employeeId?: string;

  @IsOptional()
  @Matches(ID, { message: 'workLocationId has an invalid format' })
  workLocationId?: string;

  /** SHIFT scope. */
  @IsOptional()
  @Matches(ID, { message: 'shiftId has an invalid format' })
  shiftId?: string;

  @Matches(DATE, { message: `effectiveFrom ${DATE_MSG}` })
  effectiveFrom!: string;

  @IsOptional()
  @Matches(DATE, { message: `effectiveTo ${DATE_MSG}` })
  effectiveTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class EndAssignmentDto {
  /** Last day (inclusive) on which the assignment applies. Can only shorten it. */
  @Matches(DATE, { message: `effectiveTo ${DATE_MSG}` })
  effectiveTo!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class ListAssignmentsQueryDto {
  @IsOptional()
  @Matches(ID, { message: 'calendarId has an invalid format' })
  calendarId?: string;

  @IsOptional()
  @Matches(ID, { message: 'employeeId has an invalid format' })
  employeeId?: string;

  @IsOptional()
  @Matches(ID, { message: 'shiftId has an invalid format' })
  shiftId?: string;

  @IsOptional()
  @IsIn(['current', 'all'])
  view?: 'current' | 'all';

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
  limit: number = 50;
}

export class CreateDayOverrideDto {
  /** Exactly one of calendarId (everyone on that calendar) or employeeId. */
  @IsOptional()
  @Matches(ID, { message: 'calendarId has an invalid format' })
  calendarId?: string;

  @IsOptional()
  @Matches(ID, { message: 'employeeId has an invalid format' })
  employeeId?: string;

  @Matches(DATE, { message: `date ${DATE_MSG}` })
  date!: string;

  @IsEnum(CalendarDayType)
  dayType!: CalendarDayType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class ListOverridesQueryDto {
  @IsOptional()
  @Matches(ID, { message: 'calendarId has an invalid format' })
  calendarId?: string;

  @IsOptional()
  @Matches(ID, { message: 'employeeId has an invalid format' })
  employeeId?: string;

  @IsOptional()
  @IsEnum(CalendarPolicyStatus)
  status?: CalendarPolicyStatus;
}

export class CreatePublicHolidayDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @Matches(DATE, { message: `startDate ${DATE_MSG}` })
  startDate!: string;

  @Matches(DATE, { message: `endDate ${DATE_MSG}` })
  endDate!: string;

  /** Where the date comes from (circular, decree…). Required before activation. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdatePublicHolidayDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Matches(DATE, { message: `startDate ${DATE_MSG}` })
  startDate?: string;

  @IsOptional()
  @Matches(DATE, { message: `endDate ${DATE_MSG}` })
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ListHolidaysQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2099)
  year?: number;

  @IsOptional()
  @IsEnum(CalendarPolicyStatus)
  status?: CalendarPolicyStatus;
}
