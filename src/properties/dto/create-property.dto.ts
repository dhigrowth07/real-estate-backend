import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PropertyType, PossessionStatus, PropertyStatus } from '@prisma/client';

export class CreatePropertyDto {
  @IsString()
  @IsNotEmpty({ message: 'Property title is required' })
  title: string;

  @IsString()
  @IsNotEmpty({ message: 'Location is required' })
  location: string;

  @IsNumber({}, { message: 'Price must be a valid number' })
  @Min(0, { message: 'Price cannot be negative' })
  price: number;

  @IsEnum(PropertyType, { message: 'Invalid property type' })
  propertyType: PropertyType;

  @IsString()
  @IsOptional()
  bhk?: string;

  @IsNumber({}, { message: 'Sqft must be a number' })
  @Min(0, { message: 'Sqft cannot be negative' })
  @IsOptional()
  sqft?: number;

  @IsEnum(PossessionStatus, { message: 'Invalid possession status' })
  @IsOptional()
  possessionStatus?: PossessionStatus;

  @IsArray({ message: 'Amenities must be an array' })
  @IsString({ each: true, message: 'Each amenity must be a string' })
  @IsOptional()
  amenities?: string[];

  @IsString()
  @IsOptional()
  ownerContact?: string;

  @IsArray({ message: 'Images must be an array of URLs' })
  @IsString({ each: true, message: 'Each image must be a URL string' })
  @IsOptional()
  images?: string[];

  @IsEnum(PropertyStatus, { message: 'Invalid property status' })
  @IsOptional()
  status?: PropertyStatus;

  @IsString()
  @IsOptional()
  assignedAgentId?: string;
}
