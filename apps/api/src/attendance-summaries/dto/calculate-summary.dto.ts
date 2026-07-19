import { IsDateString, IsString } from 'class-validator';

export class CalculateSummaryDto {
  @IsString()
  employeeId!: string;

  @IsDateString()
  workDate!: string;
}
