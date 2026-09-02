import { IsEnum, IsNotEmpty } from 'class-validator';
import { MatchStatus } from '@prisma/client';

export class UpdateMatchStatusDto {
  @IsEnum(MatchStatus)
  @IsNotEmpty()
  status: MatchStatus;
}
