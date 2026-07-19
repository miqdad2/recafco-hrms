import { IsString } from 'class-validator';
import { RequestCorrectionDto } from './request-correction.dto';

export class AdminRequestCorrectionDto extends RequestCorrectionDto {
  @IsString()
  employeeId!: string;
}
