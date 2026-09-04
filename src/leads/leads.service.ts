import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { MatchesService } from '../matches/matches.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadFilterDto } from './dto/lead-filter.dto';
import { Prisma, UserRole, AgentVisibilityMode } from '@prisma/client';

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
    @Inject(forwardRef(() => MatchesService))
    private matchesService: MatchesService,
  ) {}

  /**
   * Create a new Lead with optional auto-assignment for Agents and triggers matching scan
   */
  async create(user: any, dto: CreateLeadDto) {
    if (dto.budgetMin > dto.budgetMax) {
      throw new BadRequestException('Minimum budget cannot exceed maximum budget.');
    }

    // Auto-assign to creating agent if not explicitly specified
    let assignedAgentId = dto.assignedAgentId;
    if (user?.role === UserRole.AGENT && !assignedAgentId) {
      assignedAgentId = user.id;
    }

    const lead = await this.prisma.lead.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        email: dto.email ? dto.email.toLowerCase() : undefined,
        source: dto.source || 'WEBSITE',
        budgetMin: dto.budgetMin,
        budgetMax: dto.budgetMax,
        preferredLocations: dto.preferredLocations || [],
        propertyType: dto.propertyType,
        bhk: dto.bhk,
        purpose: dto.purpose || 'BUY',
        urgency: dto.urgency || 'IMMEDIATE',
        stage: dto.stage || 'NEW',
        assignedAgentId,
      },
      include: {
        assignedAgent: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    // Auto-trigger matching engine re-scan
    await this.matchesService.generateMatchesForLead(lead.id);

    return lead;
  }

  /**
   * Find all active leads with filtering and visibility rules
   */
  async findAll(user: any, filter?: LeadFilterDto) {
    const where: Prisma.LeadWhereInput = {};

    // By default, exclude soft-deleted leads
    if (!filter?.includeDeleted || user?.role !== UserRole.ADMIN) {
      where.deletedAt = null;
    }

    // Enforce Agent Visibility Rules
    const visibilityMode = await this.settingsService.getVisibilityMode();
    if (user?.role === UserRole.AGENT && visibilityMode === AgentVisibilityMode.ASSIGNED_ONLY) {
      where.assignedAgentId = user.id;
    } else if (filter?.assignedAgentId) {
      where.assignedAgentId = filter.assignedAgentId;
    }

    // Filters
    if (filter?.stage) {
      where.stage = filter.stage;
    }
    if (filter?.source) {
      where.source = filter.source;
    }
    if (filter?.urgency) {
      where.urgency = filter.urgency;
    }
    if (filter?.propertyType) {
      where.propertyType = filter.propertyType;
    }
    if (filter?.purpose) {
      where.purpose = filter.purpose;
    }
    if (filter?.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { phone: { contains: filter.search, mode: 'insensitive' } },
        { email: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.lead.findMany({
      where,
      include: {
        assignedAgent: {
          select: { id: true, name: true, email: true, role: true },
        },
        matches: {
          select: { id: true, score: true, propertyId: true, status: true },
          orderBy: { score: 'desc' },
          take: 5,
        },
        interactions: {
          select: { id: true, channel: true, type: true, timestamp: true, notes: true, createdAt: true },
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
        _count: {
          select: { matches: true, interactions: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find a single lead by ID with matches and interactions relations
   */
  async findOne(id: string, user?: any) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
      include: {
        assignedAgent: {
          select: { id: true, name: true, email: true, role: true },
        },
        matches: {
          include: {
            property: true,
          },
          orderBy: { score: 'desc' },
        },
        interactions: {
          include: {
            agent: { select: { id: true, name: true, email: true } },
          },
          orderBy: { timestamp: 'desc' },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID ${id} not found`);
    }

    // Check visibility permissions for Agents
    if (user && user.role === UserRole.AGENT) {
      const visibilityMode = await this.settingsService.getVisibilityMode();
      if (
        visibilityMode === AgentVisibilityMode.ASSIGNED_ONLY &&
        lead.assignedAgentId !== user.id
      ) {
        throw new NotFoundException(`Lead with ID ${id} not found`);
      }
    }

    return lead;
  }

  /**
   * Update lead and trigger matching re-scan
   */
  async update(id: string, dto: UpdateLeadDto, user?: any) {
    const existing = await this.findOne(id, user);

    const budgetMin = dto.budgetMin !== undefined ? dto.budgetMin : existing.budgetMin;
    const budgetMax = dto.budgetMax !== undefined ? dto.budgetMax : existing.budgetMax;
    if (budgetMin > budgetMax) {
      throw new BadRequestException('Minimum budget cannot exceed maximum budget.');
    }

    const data: any = { ...dto };
    if (dto.email) {
      data.email = dto.email.toLowerCase();
    }

    const updated = await this.prisma.lead.update({
      where: { id },
      data,
      include: {
        assignedAgent: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    // Re-scan matching engine
    await this.matchesService.generateMatchesForLead(id);

    return updated;
  }

  /**
   * Soft-delete a lead
   */
  async remove(id: string, user?: any) {
    await this.findOne(id, user);

    await this.prisma.lead.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return {
      success: true,
      message: `Lead ${id} has been soft-deleted.`,
    };
  }

  /**
   * Restore a soft-deleted lead
   */
  async restore(id: string, user?: any) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        assignedAgent: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID ${id} not found`);
    }

    if (user && user.role === UserRole.AGENT) {
      const visibilityMode = await this.settingsService.getVisibilityMode();
      if (
        visibilityMode === AgentVisibilityMode.ASSIGNED_ONLY &&
        lead.assignedAgentId !== user.id
      ) {
        throw new NotFoundException(`Lead with ID ${id} not found`);
      }
    }

    if (!lead.deletedAt) {
      throw new BadRequestException('Lead is not deleted.');
    }

    const restored = await this.prisma.lead.update({
      where: { id },
      data: { deletedAt: null },
      include: {
        assignedAgent: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    // Re-calculate matches for restored lead
    await this.matchesService.generateMatchesForLead(id);

    return restored;
  }
}
