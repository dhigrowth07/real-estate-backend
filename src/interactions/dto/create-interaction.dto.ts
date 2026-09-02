import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { InteractionChannel, InteractionType } from '@prisma/client';

export class CreateInteractionDto {
  @IsString()
  @IsNotEmpty()
  leadId: string;

  @IsEnum(InteractionChannel)
  @IsOptional()
  channel?: InteractionChannel;

  @IsEnum(InteractionType)
  @IsOptional()
  type?: InteractionType;

  @IsString()
  @IsNotEmpty()
  notes: string;
}
