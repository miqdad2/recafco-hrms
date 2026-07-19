import { CorrectionType, PunchType } from '@recafco/db';
import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

const TYPES_REQUIRING_PUNCH_TIME: CorrectionType[] = [
  CorrectionType.MISSED_IN,
  CorrectionType.MISSED_OUT,
  CorrectionType.WRONG_IN,
  CorrectionType.WRONG_OUT,
  CorrectionType.MANUAL_ADJUSTMENT,
];

const TYPES_REQUIRING_TARGET_PUNCH: CorrectionType[] = [CorrectionType.WRONG_IN, CorrectionType.WRONG_OUT];

export class RequestCorrectionDto {
  @IsISO8601()
  workDate!: string;

  @IsEnum(CorrectionType)
  correctionType!: CorrectionType;

  /** Only consulted for MANUAL_ADJUSTMENT — MISSED_IN/MISSED_OUT/WRONG_IN/WRONG_OUT derive their punch type from correctionType itself. */
  @ValidateIf((o: RequestCorrectionDto) => o.correctionType === CorrectionType.MANUAL_ADJUSTMENT)
  @IsEnum(PunchType)
  requestedPunchType?: PunchType;

  @ValidateIf((o: RequestCorrectionDto) => TYPES_REQUIRING_PUNCH_TIME.includes(o.correctionType))
  @IsISO8601()
  requestedPunchTime?: string;

  @ValidateIf((o: RequestCorrectionDto) => TYPES_REQUIRING_TARGET_PUNCH.includes(o.correctionType))
  @IsString()
  targetPunchId?: string;

  @IsString()
  @MaxLength(1000)
  reason!: string;
}
