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
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyFilterDto } from './dto/property-filter.dto';
import { Prisma, UserRole, AgentVisibilityMode } from '@prisma/client';

@Injectable()
export class PropertiesService {
  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
    @Inject(forwardRef(() => MatchesService))
    private matchesService: MatchesService,
  ) {}

  /**
   * Create a new Property with optional auto-assignment for Agents and trigger matching scan
   */
  async create(user: any, dto: CreatePropertyDto) {
    let assignedAgentId = dto.assignedAgentId;
    if (user?.role === UserRole.AGENT && !assignedAgentId) {
      assignedAgentId = user.id;
    }

    const property = await this.prisma.property.create({
      data: {
        title: dto.title,
        location: dto.location,
        price: dto.price,
        propertyType: dto.propertyType,
        bhk: dto.bhk,
        sqft: dto.sqft,
        possessionStatus: dto.possessionStatus || 'READY_TO_MOVE',
        amenities: dto.amenities || [],
        ownerContact: dto.ownerContact || user?.email || user?.phone || 'Direct Agency',
        images: dto.images || [],
        status: dto.status || 'AVAILABLE',
        assignedAgentId,
      },
      include: {
        assignedAgent: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    // Auto-trigger matching engine re-scan
    await this.matchesService.generateMatchesForProperty(property.id);

    return property;
  }

  /**
   * List properties with multi-criteria filtering and visibility rules
   */
  async findAll(user: any, filter?: PropertyFilterDto) {
    const where: Prisma.PropertyWhereInput = {};

    // By default, exclude soft-deleted properties
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

    // Filter criteria
    if (filter?.propertyType) {
      where.propertyType = filter.propertyType;
    }
    if (filter?.status) {
      where.status = filter.status;
    }
    if (filter?.possessionStatus) {
      where.possessionStatus = filter.possessionStatus;
    }
    if (filter?.bhk) {
      where.bhk = { contains: filter.bhk, mode: 'insensitive' };
    }
    if (filter?.location) {
      where.location = { contains: filter.location, mode: 'insensitive' };
    }
    if (filter?.minPrice !== undefined || filter?.maxPrice !== undefined) {
      where.price = {};
      if (filter.minPrice !== undefined) where.price.gte = filter.minPrice;
      if (filter.maxPrice !== undefined) where.price.lte = filter.maxPrice;
    }
    if (filter?.search) {
      where.OR = [
        { title: { contains: filter.search, mode: 'insensitive' } },
        { location: { contains: filter.search, mode: 'insensitive' } },
        { bhk: { contains: filter.search, mode: 'insensitive' } },
        { ownerContact: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.property.findMany({
      where,
      include: {
        assignedAgent: {
          select: { id: true, name: true, email: true, role: true },
        },
        _count: {
          select: { matches: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find one property by ID with relations
   */
  async findOne(id: string, user?: any) {
    const property = await this.prisma.property.findFirst({
      where: { id, deletedAt: null },
      include: {
        assignedAgent: {
          select: { id: true, name: true, email: true, role: true },
        },
        matches: {
          include: {
            lead: true,
          },
          orderBy: { score: 'desc' },
        },
      },
    });

    if (!property) {
      throw new NotFoundException(`Property with ID ${id} not found`);
    }

    // Visibility permission check for agents
    if (user && user.role === UserRole.AGENT) {
      const visibilityMode = await this.settingsService.getVisibilityMode();
      if (
        visibilityMode === AgentVisibilityMode.ASSIGNED_ONLY &&
        property.assignedAgentId !== user.id
      ) {
        throw new NotFoundException(`Property with ID ${id} not found`);
      }
    }

    return property;
  }

  /**
   * Update property and trigger matching re-scan
   */
  async update(id: string, dto: UpdatePropertyDto, user?: any) {
    await this.findOne(id, user);

    const updated = await this.prisma.property.update({
      where: { id },
      data: dto,
      include: {
        assignedAgent: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    // Re-scan matching engine
    await this.matchesService.generateMatchesForProperty(id);

    return updated;
  }

  /**
   * Soft-delete property
   */
  async remove(id: string, user?: any) {
    await this.findOne(id, user);

    await this.prisma.property.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return {
      success: true,
      message: `Property ${id} has been soft-deleted.`,
    };
  }

  /**
   * Restore soft-deleted property
   */
  async restore(id: string, user?: any) {
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: {
        assignedAgent: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    if (!property) {
      throw new NotFoundException(`Property with ID ${id} not found`);
    }

    if (user && user.role === UserRole.AGENT) {
      const visibilityMode = await this.settingsService.getVisibilityMode();
      if (
        visibilityMode === AgentVisibilityMode.ASSIGNED_ONLY &&
        property.assignedAgentId !== user.id
      ) {
        throw new NotFoundException(`Property with ID ${id} not found`);
      }
    }

    if (!property.deletedAt) {
      throw new BadRequestException('Property is not deleted.');
    }

    const restored = await this.prisma.property.update({
      where: { id },
      data: { deletedAt: null },
      include: {
        assignedAgent: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    // Re-scan matching engine for restored property
    await this.matchesService.generateMatchesForProperty(id);

    return restored;
  }
}
