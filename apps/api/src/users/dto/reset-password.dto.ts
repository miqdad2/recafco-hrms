import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  temporaryPassword?: string;
}
