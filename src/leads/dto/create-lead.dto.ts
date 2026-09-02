import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { LeadSource, LeadPurpose, LeadUrgency, LeadStage, PropertyType } from '@prisma/client';

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsEnum(LeadSource)
  @IsOptional()
  source?: LeadSource;

  @IsNumber()
  @Min(0)
  budgetMin: number;

  @IsNumber()
  @Min(0)
  budgetMax: number;

  @IsArray()
  @IsString({ each: true })
  preferredLocations: string[];

  @IsEnum(PropertyType)
  propertyType: PropertyType;

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
