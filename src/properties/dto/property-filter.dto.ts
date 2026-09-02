import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PropertyType, PropertyStatus, PossessionStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class PropertyFilterDto {
  @IsEnum(PropertyType)
  @IsOptional()
  propertyType?: PropertyType;

  @IsEnum(PropertyStatus)
  @IsOptional()
  status?: PropertyStatus;

  @IsEnum(PossessionStatus)
  @IsOptional()
  possessionStatus?: PossessionStatus;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  minPrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  maxPrice?: number;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  search?: string;
}
