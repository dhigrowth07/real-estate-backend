import { IsEnum, IsOptional, IsString } from 'class-validator';
import { LeadStage, PropertyType, LeadPurpose } from '@prisma/client';

export class LeadFilterDto {
  @IsEnum(LeadStage)
  @IsOptional()
  stage?: LeadStage;

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
}
