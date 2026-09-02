import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PropertyType, PossessionStatus, PropertyStatus } from '@prisma/client';

export class CreatePropertyDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  location: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsEnum(PropertyType)
  propertyType: PropertyType;

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
  @IsNotEmpty()
  ownerContact: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  images?: string[];

  @IsEnum(PropertyStatus)
  @IsOptional()
  status?: PropertyStatus;
}
