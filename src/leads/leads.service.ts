import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadFilterDto } from './dto/lead-filter.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class LeadsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateLeadDto) {
    const lead = await this.prisma.lead.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        source: dto.source || 'WEBSITE',
        budgetMin: dto.budgetMin,
        budgetMax: dto.budgetMax,
        preferredLocations: dto.preferredLocations || [],
        propertyType: dto.propertyType,
        bhk: dto.bhk,
        purpose: dto.purpose || 'BUY',
        urgency: dto.urgency || 'IMMEDIATE',
        stage: dto.stage || 'NEW',
        assignedAgentId: dto.assignedAgentId,
      },
      include: {
        assignedAgent: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    return lead;
  }

  async findAll(filter?: LeadFilterDto) {
    const where: Prisma.LeadWhereInput = {};

    if (filter?.stage) {
      where.stage = filter.stage;
    }
    if (filter?.propertyType) {
      where.propertyType = filter.propertyType;
    }
    if (filter?.purpose) {
      where.purpose = filter.purpose;
    }
    if (filter?.assignedAgentId) {
      where.assignedAgentId = filter.assignedAgentId;
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
        _count: {
          select: { matches: true, interactions: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
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
            agent: { select: { id: true, name: true } },
          },
          orderBy: { timestamp: 'desc' },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID ${id} not found`);
    }

    return lead;
  }

  async update(id: string, dto: UpdateLeadDto) {
    await this.findOne(id);

    return this.prisma.lead.update({
      where: { id },
      data: dto,
      include: {
        assignedAgent: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.lead.delete({
      where: { id },
    });
  }
}
