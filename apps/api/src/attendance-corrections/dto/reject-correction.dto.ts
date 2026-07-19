import { IsString, MaxLength } from 'class-validator';

export class RejectCorrectionDto {
  @IsString()
  @MaxLength(1000)
  rejectedReason!: string;
}
