import { IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { MatchStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class MatchFilterDto {
  @IsString()
  @IsOptional()
  leadId?: string;

  @IsString()
  @IsOptional()
  propertyId?: string;

  @IsEnum(MatchStatus)
  @IsOptional()
  status?: MatchStatus;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  minScore?: number;
}
