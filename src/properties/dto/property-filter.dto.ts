import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { PropertyType, PropertyStatus, PossessionStatus } from '@prisma/client';
import { Type, Transform } from 'class-transformer';

export class PropertyFilterDto {
  @IsString()
  @IsOptional()
  location?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  minPrice?: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  maxPrice?: number;

  @IsEnum(PropertyType)
  @IsOptional()
  propertyType?: PropertyType;

  @IsEnum(PropertyStatus)
  @IsOptional()
  status?: PropertyStatus;

  @IsEnum(PossessionStatus)
  @IsOptional()
  possessionStatus?: PossessionStatus;

  @IsString()
  @IsOptional()
  bhk?: string;

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
