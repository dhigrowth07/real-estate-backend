import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInteractionDto } from './dto/create-interaction.dto';

@Injectable()
export class InteractionsService {
  constructor(private prisma: PrismaService) {}

  async create(agentId: string, dto: CreateInteractionDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id: dto.leadId } });
    if (!lead) {
      throw new NotFoundException(`Lead with ID ${dto.leadId} not found`);
    }

    return this.prisma.interaction.create({
      data: {
        leadId: dto.leadId,
        agentId,
        channel: dto.channel || 'CALL',
        type: dto.type || 'FOLLOW_UP',
        notes: dto.notes,
      },
      include: {
        agent: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async findByLead(leadId: string) {
    return this.prisma.interaction.findMany({
      where: { leadId },
      include: {
        agent: { select: { id: true, name: true, email: true } },
      },
      orderBy: { timestamp: 'desc' },
    });
  }
}
