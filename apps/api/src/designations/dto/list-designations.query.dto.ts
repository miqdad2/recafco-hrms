import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { parseQueryBoolean } from '../../common/query-boolean.transform';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListDesignationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  isActive?: boolean;
}
