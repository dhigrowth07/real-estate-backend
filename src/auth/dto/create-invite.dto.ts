import { IsEmail, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateInviteDto {
  @IsEmail({}, { message: 'Please provide a valid email address for the invitee' })
  @IsNotEmpty()
  email: string;

  @IsEnum(UserRole, { message: 'Role must be either ADMIN or AGENT' })
  @IsOptional()
  role?: UserRole;
}
