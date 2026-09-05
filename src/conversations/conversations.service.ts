import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ChannelType, MessageDirection, MessageType, MessageStatus, InteractionChannel, InteractionType } from '@prisma/client';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves all conversations, optionally filtered by channel, leadId, or search query
   */
  async findAll(channel?: ChannelType, search?: string, leadId?: string) {
    const where: any = {};

    if (channel) {
      where.channel = channel;
    }

    if (leadId) {
      where.leadId = leadId;
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { externalId: { contains: q, mode: 'insensitive' } },
        {
          lead: {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
        {
          messages: {
            some: {
              rawText: { contains: q, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    const conversations = await this.prisma.conversation.findMany({
      where,
      include: {
        lead: {
          include: {
            interestedProperty: true,
            assignedAgent: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            messages: {
              where: {
                direction: MessageDirection.INBOUND,
                status: { not: MessageStatus.READ },
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return conversations.map((conv) => ({
      ...conv,
      lastMessage: conv.messages[0] || null,
      unreadCount: conv._count.messages,
    }));
  }

  /**
   * Retrieves detailed conversation by ID with full chronological message thread
   */
  async findOne(id: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        lead: {
          include: {
            interestedProperty: true,
            assignedAgent: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation with ID "${id}" not found`);
    }

    return conversation;
  }

  /**
   * Sends a manual agent reply on a conversation
   */
  async sendMessage(conversationId: string, userId: string, dto: SendMessageDto) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation with ID "${conversationId}" not found`);
    }

    // 1. Create OUTBOUND message record
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        direction: MessageDirection.OUTBOUND,
        messageType: MessageType.TEXT,
        rawText: dto.rawText.trim(),
        status: MessageStatus.SENT,
      },
    });

    // 2. Refresh conversation updatedAt
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    // 3. Log an Interaction touchpoint if the conversation is associated with a Lead
    if (conversation.leadId) {
      try {
        const interactionChannel =
          conversation.channel === ChannelType.WHATSAPP
            ? InteractionChannel.WHATSAPP
            : InteractionChannel.NOTE;

        await this.prisma.interaction.create({
          data: {
            leadId: conversation.leadId,
            agentId: userId,
            channel: interactionChannel,
            type: InteractionType.FOLLOW_UP,
            notes: `Agent Outbound (${conversation.channel}): ${dto.rawText.trim()}`,
          },
        });
      } catch (err: any) {
        this.logger.warn(`Failed to log Interaction for agent reply: ${err?.message}`);
      }
    }

    return message;
  }

  /**
   * Marks all incoming unread messages in a conversation as READ
   */
  async markAsRead(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation with ID "${conversationId}" not found`);
    }

    const result = await this.prisma.message.updateMany({
      where: {
        conversationId,
        direction: MessageDirection.INBOUND,
        status: { not: MessageStatus.READ },
      },
      data: {
        status: MessageStatus.READ,
      },
    });

    return { updated: result.count };
  }
}
