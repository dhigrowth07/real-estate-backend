import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { FirstAdminSignupDto } from './dto/first-admin-signup.dto';
import { CreateInviteDto } from './dto/create-invite.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { UserRole } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  /**
   * First user signup bootstrap: Creates the single agency Admin.
   * Direct public signup is rejected once at least one user exists.
   */
  async signupFirstAdmin(dto: FirstAdminSignupDto) {
    const userCount = await this.prisma.user.count();
    if (userCount > 0) {
      throw new BadRequestException(
        'Direct registration is disabled. Please contact your Admin for an invite to join the team.',
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const adminUser = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email.toLowerCase(),
        passwordHash,
        role: UserRole.ADMIN,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    // Ensure default agency settings exist
    await this.prisma.agencySetting.upsert({
      where: { id: 'default' },
      create: { id: 'default', agentVisibilityMode: 'ALL' },
      update: {},
    });

    const token = this.generateToken(adminUser.id, adminUser.email, adminUser.role);

    return {
      user: adminUser,
      accessToken: token,
      message: 'Admin account created successfully.',
    };
  }

  /**
   * Admin generates an invite for a new Agent (or Admin).
   */
  async createInvite(adminId: string, dto: CreateInviteDto) {
    const normalizedEmail = dto.email.toLowerCase();

    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      throw new ConflictException('A user with this email is already registered.');
    }

    // Check if there is already an active pending invite
    const existingInvite = await this.prisma.invite.findFirst({
      where: {
        email: normalizedEmail,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (existingInvite) {
      return {
        ...existingInvite,
        message: 'Active pending invite already exists for this email.',
      };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invite = await this.prisma.invite.create({
      data: {
        email: normalizedEmail,
        token,
        role: dto.role || UserRole.AGENT,
        expiresAt,
        createdById: adminId,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return invite;
  }

  /**
   * List all invites (Admin only)
   */
  async getInvites() {
    return this.prisma.invite.findMany({
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Revoke / delete a pending invite
   */
  async revokeInvite(inviteId: string) {
    const invite = await this.prisma.invite.findUnique({ where: { id: inviteId } });
    if (!invite) {
      throw new NotFoundException(`Invite with ID ${inviteId} not found`);
    }

    return this.prisma.invite.delete({ where: { id: inviteId } });
  }

  /**
   * Invitee signs up using the invite token
   */
  async acceptInvite(dto: AcceptInviteDto) {
    const invite = await this.prisma.invite.findUnique({
      where: { token: dto.token },
    });

    if (!invite || invite.usedAt !== null) {
      throw new BadRequestException('Invalid or already used invite token.');
    }

    if (new Date() > invite.expiresAt) {
      throw new BadRequestException('This invite has expired. Please request a new invite.');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: invite.email },
    });
    if (existingUser) {
      throw new ConflictException('A user with this email is already registered.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const [newUser] = await this.prisma.$transaction([
      this.prisma.user.create({
        data: {
          name: dto.name,
          email: invite.email,
          passwordHash,
          role: invite.role,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
        },
      }),
      this.prisma.invite.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      }),
    ]);

    const token = this.generateToken(newUser.id, newUser.email, newUser.role);

    return {
      user: newUser,
      accessToken: token,
      message: 'Account created successfully from invite.',
    };
  }

  /**
   * Login with email and password
   */
  async login(dto: LoginDto) {
    const normalizedEmail = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const token = this.generateToken(user.id, user.email, user.role);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
      accessToken: token,
    };
  }

  private generateToken(userId: string, email: string, role: string): string {
    return this.jwtService.sign({
      sub: userId,
      email,
      role,
    });
  }
}
