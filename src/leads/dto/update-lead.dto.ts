import { IsArray, IsEmail, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { LeadSource, LeadPurpose, LeadUrgency, LeadStage, PropertyType } from '@prisma/client';

export class UpdateLeadDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsEnum(LeadSource)
  @IsOptional()
  source?: LeadSource;

  @IsNumber()
  @Min(0)
  @IsOptional()
  budgetMin?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  budgetMax?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  preferredLocations?: string[];

  @IsEnum(PropertyType)
  @IsOptional()
  propertyType?: PropertyType;

  @IsString()
  @IsOptional()
  bhk?: string;

  @IsEnum(LeadPurpose)
  @IsOptional()
  purpose?: LeadPurpose;

  @IsEnum(LeadUrgency)
  @IsOptional()
  urgency?: LeadUrgency;

  @IsEnum(LeadStage)
  @IsOptional()
  stage?: LeadStage;

  @IsString()
  @IsOptional()
  assignedAgentId?: string;
}
