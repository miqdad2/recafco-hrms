import { CorrectionStatus } from '@recafco/db';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListMyAttendanceCorrectionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(CorrectionStatus)
  status?: CorrectionStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
