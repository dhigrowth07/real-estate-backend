import { Controller, Post, Body, Get, Delete, Param, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { FirstAdminSignupDto } from './dto/first-admin-signup.dto';
import { CreateInviteDto } from './dto/create-invite.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * First user signup (creates the single agency Admin)
   */
  @Post('signup')
  signupFirstAdmin(@Body() dto: FirstAdminSignupDto) {
    return this.authService.signupFirstAdmin(dto);
  }

  /**
   * Agent registration via Admin invite token
   */
  @Post('accept-invite')
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.authService.acceptInvite(dto);
  }

  /**
   * Login with email and password
   */
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * Current authenticated user profile
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@CurrentUser() user: any) {
    return user;
  }

  /**
   * Admin generates an agent invite
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('invites')
  createInvite(@CurrentUser() user: any, @Body() dto: CreateInviteDto) {
    return this.authService.createInvite(user.id, dto);
  }

  /**
   * Admin lists all invites
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('invites')
  getInvites() {
    return this.authService.getInvites();
  }

  /**
   * Admin revokes a pending invite
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete('invites/:id')
  revokeInvite(@Param('id') id: string) {
    return this.authService.revokeInvite(id);
  }
}
