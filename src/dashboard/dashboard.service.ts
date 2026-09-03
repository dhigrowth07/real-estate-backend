import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { UserRole, AgentVisibilityMode, LeadSource, LeadStage, Prisma } from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
  ) {}

  /**
   * Helper to build visibility filter for leads, properties, and matches
   */
  private async getVisibilityFilters(user: any) {
    const visibilityMode = await this.settingsService.getVisibilityMode();
    const isRestricted =
      user?.role === UserRole.AGENT && visibilityMode === AgentVisibilityMode.ASSIGNED_ONLY;

    const leadWhere: Prisma.LeadWhereInput = {
      deletedAt: null,
      ...(isRestricted ? { assignedAgentId: user.id } : {}),
    };

    const propertyWhere: Prisma.PropertyWhereInput = {
      deletedAt: null,
      ...(isRestricted ? { assignedAgentId: user.id } : {}),
    };

    const matchWhere: Prisma.MatchWhereInput = {
      lead: { deletedAt: null },
      property: { deletedAt: null },
      ...(isRestricted
        ? {
            OR: [
              { lead: { assignedAgentId: user.id } },
              { property: { assignedAgentId: user.id } },
            ],
          }
        : {}),
    };

    return { leadWhere, propertyWhere, matchWhere, isRestricted };
  }

  /**
   * Get KPI statistics and distributions
   */
  async getStats(user: any) {
    const { leadWhere, propertyWhere, matchWhere } = await this.getVisibilityFilters(user);

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalActiveLeads,
      totalProperties,
      hotMatchesToday,
      dealsClosedThisMonth,
      rawLeadsBySource,
      rawLeadsByStage,
    ] = await Promise.all([
      // 1. Total Active Leads (excluding won, lost, deleted)
      this.prisma.lead.count({
        where: {
          ...leadWhere,
          stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
        },
      }),

      // 2. Total Properties (available inventory)
      this.prisma.property.count({
        where: {
          ...propertyWhere,
          status: 'AVAILABLE',
        },
      }),

      // 3. Hot Matches Today (score > 80, created or updated today)
      this.prisma.match.count({
        where: {
          ...matchWhere,
          score: { gt: 80 },
          updatedAt: { gte: startOfDay },
        },
      }),

      // 4. Deals Closed This Month (stage: CLOSED_WON in current month)
      this.prisma.lead.count({
        where: {
          ...leadWhere,
          stage: 'CLOSED_WON',
          updatedAt: { gte: startOfMonth },
        },
      }),

      // 5. Leads by Source
      this.prisma.lead.groupBy({
        by: ['source'],
        where: leadWhere,
        _count: { source: true },
      }),

      // 6. Leads by Stage
      this.prisma.lead.groupBy({
        by: ['stage'],
        where: leadWhere,
        _count: { stage: true },
      }),
    ]);

    // Format distributions ensuring all enum values are present
    const allSources = Object.values(LeadSource);
    const leadsBySource = allSources.map((source) => {
      const found = rawLeadsBySource.find((item) => item.source === source);
      return {
        source,
        count: found ? found._count.source : 0,
      };
    });

    const allStages = Object.values(LeadStage);
    const leadsByStage = allStages.map((stage) => {
      const found = rawLeadsByStage.find((item) => item.stage === stage);
      return {
        stage,
        count: found ? found._count.stage : 0,
      };
    });

    return {
      kpis: {
        totalActiveLeads,
        totalProperties,
        hotMatchesToday,
        dealsClosedThisMonth,
      },
      distributions: {
        leadsBySource,
        leadsByStage,
      },
    };
  }

  /**
   * Get last 5 recent leads
   */
  async getRecentLeads(user: any) {
    const { leadWhere } = await this.getVisibilityFilters(user);

    return this.prisma.lead.findMany({
      where: leadWhere,
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        assignedAgent: {
          select: { id: true, name: true, email: true, role: true },
        },
        _count: {
          select: { matches: true, interactions: true },
        },
      },
    });
  }

  /**
   * Get aging inventory: properties listed 30+ days ago with no match above 50%
   */
  async getAgingInventory(user: any) {
    const { propertyWhere } = await this.getVisibilityFilters(user);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    return this.prisma.property.findMany({
      where: {
        ...propertyWhere,
        status: 'AVAILABLE',
        createdAt: { lte: thirtyDaysAgo },
        matches: {
          none: {
            score: { gte: 50 },
          },
        },
      },
      include: {
        assignedAgent: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { matches: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get full dashboard overview payload
   */
  async getDashboardSummary(user: any) {
    const [stats, recentLeads, agingInventory] = await Promise.all([
      this.getStats(user),
      this.getRecentLeads(user),
      this.getAgingInventory(user),
    ]);

    return {
      ...stats,
      recentLeads,
      agingInventory,
    };
  }
}
