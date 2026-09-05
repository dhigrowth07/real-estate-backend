import { Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  MatchingEngineService,
  MatchingWeights,
  DEFAULT_MATCHING_WEIGHTS,
} from './matching-engine.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UpdateMatchStatusDto } from './dto/update-match-status.dto';
import { MatchFilterDto } from './dto/match-filter.dto';
import { UpdateMatchingWeightsDto } from './dto/update-matching-weights.dto';
import { Prisma, UserRole, AgentVisibilityMode } from '@prisma/client';

@Injectable()
export class MatchesService {
  constructor(
    private prisma: PrismaService,
    private matchingEngine: MatchingEngineService,
    private settingsService: SettingsService,
    @Inject(forwardRef(() => NotificationsService))
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Helper to retrieve active scoring weights from AgencySetting
   */
  async getActiveWeights(): Promise<MatchingWeights> {
    const settings = await this.settingsService.getSettings();
    if (settings.matchingWeights && typeof settings.matchingWeights === 'object') {
      return {
        ...DEFAULT_MATCHING_WEIGHTS,
        ...(settings.matchingWeights as Partial<MatchingWeights>),
      };
    }
    return DEFAULT_MATCHING_WEIGHTS;
  }

  /**
   * Update configurable scoring weights in database
   */
  async updateWeights(dto: UpdateMatchingWeightsDto) {
    const currentWeights = await this.getActiveWeights();
    const updatedWeights = {
      ...currentWeights,
      ...dto,
    };

    await this.prisma.agencySetting.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        agentVisibilityMode: AgentVisibilityMode.ALL,
        matchingWeights: updatedWeights as any,
      },
      update: {
        matchingWeights: updatedWeights as any,
      },
    });

    return updatedWeights;
  }

  /**
  /**
   * Creates or updates an explicit high-confidence match (score=100)
   * for direct listing inquiries
   */
  async createExplicitMatch(leadId: string, propertyId: string) {
    const breakdown = {
      isExplicit: true,
      explicitReason: 'Direct inquiry on property listing',
      budget: 35,
      location: 25,
      propertyType: 20,
      bhk: 10,
      possession: 10,
    };

    const match = await this.prisma.match.upsert({
      where: {
        leadId_propertyId: {
          leadId,
          propertyId,
        },
      },
      create: {
        leadId,
        propertyId,
        score: 100,
        isExplicit: true,
        breakdown,
      },
      update: {
        score: 100,
        isExplicit: true,
        breakdown,
      },
    });

    await this.notificationsService.handleMatchAlert(match.id);
    return match;
  }

  /**
   * Evaluates compatibility and persists matches for a specific lead against all available properties.
   * If the lead has an interestedPropertyId set, that match receives score = 100 and isExplicit = true,
   * while all other properties are still scored normally by the matching engine.
   */
  async generateMatchesForLead(leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
    });
    if (!lead) return [];

    const properties = await this.prisma.property.findMany({
      where: {
        status: 'AVAILABLE',
        deletedAt: null,
      },
    });

    const weights = await this.getActiveWeights();
    const results = [];

    for (const property of properties) {
      const isDirectInterest = lead.interestedPropertyId === property.id;
      const evaluation = this.matchingEngine.calculateScore(lead, property, weights);
      const finalScore = isDirectInterest ? 100 : evaluation.score;
      const finalBreakdown = isDirectInterest
        ? {
            ...evaluation.breakdown,
            isExplicit: true,
            explicitReason: 'Direct inquiry on property listing',
          }
        : {
            ...evaluation.breakdown,
            isExplicit: false,
          };

      const match = await this.prisma.match.upsert({
        where: {
          leadId_propertyId: {
            leadId: lead.id,
            propertyId: property.id,
          },
        },
        create: {
          leadId: lead.id,
          propertyId: property.id,
          score: finalScore,
          isExplicit: isDirectInterest,
          breakdown: finalBreakdown,
        },
        update: {
          score: finalScore,
          isExplicit: isDirectInterest,
          breakdown: finalBreakdown,
        },
      });

      // Dispatch real-time alert if threshold is met
      await this.notificationsService.handleMatchAlert(match.id);

      results.push(match);
    }

    return results;
  }

  /**
   * Evaluates compatibility and persists matches for a specific property against all active leads.
   * Preserves explicit matches for leads that directly inquired on this property.
   */
  async generateMatchesForProperty(propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, deletedAt: null },
    });
    if (!property) return [];

    const leads = await this.prisma.lead.findMany({
      where: {
        stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
        deletedAt: null,
      },
    });

    const weights = await this.getActiveWeights();
    const results = [];

    for (const lead of leads) {
      const isDirectInterest = lead.interestedPropertyId === property.id;
      const evaluation = this.matchingEngine.calculateScore(lead, property, weights);
      const finalScore = isDirectInterest ? 100 : evaluation.score;
      const finalBreakdown = isDirectInterest
        ? {
            ...evaluation.breakdown,
            isExplicit: true,
            explicitReason: 'Direct inquiry on property listing',
          }
        : {
            ...evaluation.breakdown,
            isExplicit: false,
          };

      const match = await this.prisma.match.upsert({
        where: {
          leadId_propertyId: {
            leadId: lead.id,
            propertyId: property.id,
          },
        },
        create: {
          leadId: lead.id,
          propertyId: property.id,
          score: finalScore,
          isExplicit: isDirectInterest,
          breakdown: finalBreakdown,
        },
        update: {
          score: finalScore,
          isExplicit: isDirectInterest,
          breakdown: finalBreakdown,
        },
      });

      // Dispatch real-time alert if threshold is met
      await this.notificationsService.handleMatchAlert(match.id);

      results.push(match);
    }

    return results;
  }

  /**
   * List matches with filters and visibility rules
   */
  async findAll(user: any, filter?: MatchFilterDto) {
    const where: Prisma.MatchWhereInput = {
      lead: { deletedAt: null },
      property: { deletedAt: null },
    };

    // Visibility rules for Agents
    const visibilityMode = await this.settingsService.getVisibilityMode();
    if (user?.role === UserRole.AGENT && visibilityMode === AgentVisibilityMode.ASSIGNED_ONLY) {
      where.OR = [
        { lead: { assignedAgentId: user.id } },
        { property: { assignedAgentId: user.id } },
      ];
    }

    if (filter?.leadId) {
      where.leadId = filter.leadId;
    }
    if (filter?.propertyId) {
      where.propertyId = filter.propertyId;
    }
    if (filter?.status) {
      where.status = filter.status;
    }
    if (filter?.minScore !== undefined) {
      where.score = { gte: filter.minScore };
    }

    return this.prisma.match.findMany({
      where,
      include: {
        lead: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            budgetMin: true,
            budgetMax: true,
            propertyType: true,
            bhk: true,
            preferredLocations: true,
            stage: true,
            assignedAgentId: true,
          },
        },
        property: {
          select: {
            id: true,
            title: true,
            location: true,
            price: true,
            propertyType: true,
            bhk: true,
            possessionStatus: true,
            images: true,
            status: true,
            assignedAgentId: true,
          },
        },
      },
      orderBy: { score: 'desc' },
    });
  }

  /**
   * Find single match by ID with visibility check
   */
  async findOne(id: string, user?: any) {
    const match = await this.prisma.match.findFirst({
      where: {
        id,
        lead: { deletedAt: null },
        property: { deletedAt: null },
      },
      include: {
        lead: {
          include: {
            assignedAgent: { select: { id: true, name: true, email: true } },
          },
        },
        property: {
          include: {
            assignedAgent: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!match) {
      throw new NotFoundException(`Match with ID ${id} not found`);
    }

    if (user && user.role === UserRole.AGENT) {
      const visibilityMode = await this.settingsService.getVisibilityMode();
      if (
        visibilityMode === AgentVisibilityMode.ASSIGNED_ONLY &&
        match.lead.assignedAgentId !== user.id &&
        match.property.assignedAgentId !== user.id
      ) {
        throw new NotFoundException(`Match with ID ${id} not found`);
      }
    }

    return match;
  }

  /**
   * Update match status
   */
  async updateStatus(id: string, dto: UpdateMatchStatusDto, user?: any) {
    await this.findOne(id, user);

    return this.prisma.match.update({
      where: { id },
      data: { status: dto.status },
      include: {
        lead: true,
        property: true,
      },
    });
  }
}
