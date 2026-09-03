import { IsBoolean, IsOptional, IsNumber, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class NotificationFilterDto {
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  unreadOnly?: boolean;

  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number;
}
