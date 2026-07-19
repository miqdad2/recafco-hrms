import { WorkLocationType } from '@recafco/db';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { parseQueryBoolean } from '../../common/query-boolean.transform';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListWorkLocationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(WorkLocationType)
  type?: WorkLocationType;
}
