import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { LeadStage, LeadSource, LeadUrgency, PropertyType, LeadPurpose } from '@prisma/client';
import { Transform } from 'class-transformer';

export class LeadFilterDto {
  @IsEnum(LeadStage)
  @IsOptional()
  stage?: LeadStage;

  @IsEnum(LeadSource)
  @IsOptional()
  source?: LeadSource;

  @IsEnum(LeadUrgency)
  @IsOptional()
  urgency?: LeadUrgency;

  @IsEnum(PropertyType)
  @IsOptional()
  propertyType?: PropertyType;

  @IsEnum(LeadPurpose)
  @IsOptional()
  purpose?: LeadPurpose;

  @IsString()
  @IsOptional()
  assignedAgentId?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  includeDeleted?: boolean;
}
