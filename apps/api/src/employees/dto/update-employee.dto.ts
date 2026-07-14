import { EmployeeStatus, EmploymentType } from '@recafco/db';
import { IsBoolean, IsEmail, IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// TERMINATED is intentionally excluded — that transition only happens through
// the dedicated terminate endpoint (DELETE /employees/:id), which also stamps terminationDate.
const UPDATABLE_STATUSES = [
  EmployeeStatus.ACTIVE,
  EmployeeStatus.INACTIVE,
  EmployeeStatus.ON_LEAVE,
  EmployeeStatus.RESIGNED,
] as const;

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  civilId?: string;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @IsIn(UPDATABLE_STATUSES)
  status?: (typeof UPDATABLE_STATUSES)[number];

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  designationId?: string;

  @IsOptional()
  @IsString()
  workLocationId?: string;

  @IsOptional()
  @IsBoolean()
  isMobilePunchAllowed?: boolean;

  @IsOptional()
  @IsBoolean()
  isDeviceOnly?: boolean;
}
