import { CorrectionStatus, CorrectionType } from '@recafco/db';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListAttendanceCorrectionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsEnum(CorrectionStatus)
  status?: CorrectionStatus;

  @IsOptional()
  @IsEnum(CorrectionType)
  correctionType?: CorrectionType;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
