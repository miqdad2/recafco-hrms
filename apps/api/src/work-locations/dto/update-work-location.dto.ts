import { WorkLocationType } from '@recafco/db';
import {
  IsBoolean,
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

const MAX_GEOFENCE_RADIUS_METERS = 5000;

export class UpdateWorkLocationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsEnum(WorkLocationType)
  type?: WorkLocationType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_GEOFENCE_RADIUS_METERS)
  geofenceRadiusMeters?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
