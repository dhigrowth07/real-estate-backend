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
  @IsNotEmpty({ message: 'Lead name is required' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  phone: string;

  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsOptional()
  email?: string;

  @IsEnum(LeadSource, { message: 'Invalid lead source' })
  @IsOptional()
  source?: LeadSource;

  @IsNumber({}, { message: 'Minimum budget must be a number' })
  @Min(0, { message: 'Minimum budget cannot be negative' })
  budgetMin: number;

  @IsNumber({}, { message: 'Maximum budget must be a number' })
  @Min(0, { message: 'Maximum budget cannot be negative' })
  budgetMax: number;

  @IsArray({ message: 'Preferred locations must be an array' })
  @IsString({ each: true, message: 'Each preferred location must be a string' })
  @IsOptional()
  preferredLocations?: string[];

  @IsEnum(PropertyType, { message: 'Invalid property type' })
  propertyType: PropertyType;

  @IsString()
  @IsOptional()
  bhk?: string;

  @IsEnum(LeadPurpose, { message: 'Invalid lead purpose' })
  @IsOptional()
  purpose?: LeadPurpose;

  @IsEnum(LeadUrgency, { message: 'Invalid urgency timeline' })
  @IsOptional()
  urgency?: LeadUrgency;

  @IsEnum(LeadStage, { message: 'Invalid lead stage' })
  @IsOptional()
  stage?: LeadStage;

  @IsString()
  @IsOptional()
  assignedAgentId?: string;
}
