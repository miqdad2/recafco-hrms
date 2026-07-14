import { WorkLocationType } from '@recafco/db';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Sanity ceiling only (data-hygiene guard against fat-fingered units), not a policy cap.
// The real allowed-radius policy per site type is still an open company-policy question.
const MAX_GEOFENCE_RADIUS_METERS = 5000;

export class CreateWorkLocationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code!: string;

  @IsOptional()
  @IsEnum(WorkLocationType)
  type?: WorkLocationType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_GEOFENCE_RADIUS_METERS)
  geofenceRadiusMeters?: number;
}
