import { IsArray, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PropertyType, PossessionStatus, PropertyStatus } from '@prisma/client';

export class UpdatePropertyDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number;

  @IsEnum(PropertyType)
  @IsOptional()
  propertyType?: PropertyType;

  @IsString()
  @IsOptional()
  bhk?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  sqft?: number;

  @IsEnum(PossessionStatus)
  @IsOptional()
  possessionStatus?: PossessionStatus;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  amenities?: string[];

  @IsString()
  @IsOptional()
  ownerContact?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  images?: string[];

  @IsEnum(PropertyStatus)
  @IsOptional()
  status?: PropertyStatus;
}
