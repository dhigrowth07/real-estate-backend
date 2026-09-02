import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MatchingEngineService } from './matching-engine.service';
import { UpdateMatchStatusDto } from './dto/update-match-status.dto';
import { MatchFilterDto } from './dto/match-filter.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class MatchesService {
  constructor(
    private prisma: PrismaService,
    private matchingEngine: MatchingEngineService,
  ) {}

  async findAll(filter?: MatchFilterDto) {
    const where: Prisma.MatchWhereInput = {};

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
            budgetMin: true,
            budgetMax: true,
            propertyType: true,
            bhk: true,
            preferredLocations: true,
            stage: true,
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
            status: true,
          },
        },
      },
      orderBy: { score: 'desc' },
    });
  }

  async findOne(id: string) {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: {
        lead: true,
        property: true,
      },
    });

    if (!match) {
      throw new NotFoundException(`Match with ID ${id} not found`);
    }

    return match;
  }

  async updateStatus(id: string, dto: UpdateMatchStatusDto) {
    await this.findOne(id);

    return this.prisma.match.update({
      where: { id },
      data: { status: dto.status },
    });
  }

  /**
   * Evaluates compatibility and persists matches for a specific lead against all available properties
   */
  async generateMatchesForLead(leadId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException(`Lead with ID ${leadId} not found`);

    const properties = await this.prisma.property.findMany({
      where: { status: 'AVAILABLE' },
    });

    const results = [];
    for (const property of properties) {
      const evaluation = this.matchingEngine.calculateScore(lead, property);

      // Upsert match record
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
          score: evaluation.score,
          breakdown: evaluation.breakdown,
        },
        update: {
          score: evaluation.score,
          breakdown: evaluation.breakdown,
        },
      });
      results.push(match);
    }

    return results;
  }

  /**
   * Evaluates compatibility and persists matches for a specific property against all active leads
   */
  async generateMatchesForProperty(propertyId: string) {
    const property = await this.prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) throw new NotFoundException(`Property with ID ${propertyId} not found`);

    const leads = await this.prisma.lead.findMany({
      where: {
        stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] },
      },
    });

    const results = [];
    for (const lead of leads) {
      const evaluation = this.matchingEngine.calculateScore(lead, property);

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
          score: evaluation.score,
          breakdown: evaluation.breakdown,
        },
        update: {
          score: evaluation.score,
          breakdown: evaluation.breakdown,
        },
      });
      results.push(match);
    }

    return results;
  }
}
