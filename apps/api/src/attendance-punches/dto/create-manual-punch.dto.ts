import { PunchType } from '@recafco/db';
import { IsEnum, IsISO8601, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateManualPunchDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsEnum(PunchType)
  punchType!: PunchType;

  @IsISO8601()
  punchTimeSource!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
