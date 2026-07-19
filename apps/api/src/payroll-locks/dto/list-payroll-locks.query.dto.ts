import { PayrollLockStatus } from '@recafco/db';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListPayrollLocksQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PayrollLockStatus)
  status?: PayrollLockStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
