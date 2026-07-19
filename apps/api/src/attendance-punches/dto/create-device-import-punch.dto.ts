import { PunchType } from '@recafco/db';
import { IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDeviceImportPunchDto {
  @IsString()
  @IsNotEmpty()
  attendanceDeviceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  employeeCode!: string;

  @IsEnum(PunchType)
  punchType!: PunchType;

  @IsISO8601()
  punchTimeSource!: string;
}
