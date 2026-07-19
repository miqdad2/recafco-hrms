import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UnlockPayrollLockDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
