import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateMatchingWeightsDto {
  @IsNumber({}, { message: 'budgetFullMatch must be a number' })
  @Min(0, { message: 'budgetFullMatch cannot be negative' })
  @IsOptional()
  budgetFullMatch?: number;

  @IsNumber({}, { message: 'budgetPartialMatch must be a number' })
  @Min(0, { message: 'budgetPartialMatch cannot be negative' })
  @IsOptional()
  budgetPartialMatch?: number;

  @IsNumber({}, { message: 'locationMatch must be a number' })
  @Min(0, { message: 'locationMatch cannot be negative' })
  @IsOptional()
  locationMatch?: number;

  @IsNumber({}, { message: 'propertyTypeMatch must be a number' })
  @Min(0, { message: 'propertyTypeMatch cannot be negative' })
  @IsOptional()
  propertyTypeMatch?: number;

  @IsNumber({}, { message: 'bhkMatch must be a number' })
  @Min(0, { message: 'bhkMatch cannot be negative' })
  @IsOptional()
  bhkMatch?: number;

  @IsNumber({}, { message: 'possessionMatch must be a number' })
  @Min(0, { message: 'possessionMatch cannot be negative' })
  @IsOptional()
  possessionMatch?: number;
}
