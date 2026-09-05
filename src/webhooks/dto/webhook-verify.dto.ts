import { IsOptional, IsString } from 'class-validator';

export class WebhookVerifyDto {
  @IsOptional()
  @IsString()
  'hub.mode'?: string;

  @IsOptional()
  @IsString()
  'hub.verify_token'?: string;

  @IsOptional()
  @IsString()
  'hub.challenge'?: string;

  // Fallback for underscore query params if rewritten by proxies
  @IsOptional()
  @IsString()
  hub_mode?: string;

  @IsOptional()
  @IsString()
  hub_verify_token?: string;

  @IsOptional()
  @IsString()
  hub_challenge?: string;
}
