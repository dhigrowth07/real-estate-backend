import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsService } from './conversations.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { ChannelType, MessageDirection, MessageType, MessageStatus } from '@prisma/client';

describe('ConversationsService', () => {
  let service: ConversationsService;
  let prisma: PrismaService;

  const mockPrisma = {
    conversation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    message: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    interaction: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return conversations formatted with lastMessage and unreadCount', async () => {
      const mockRawConversations = [
        {
          id: 'conv-1',
          channel: ChannelType.WHATSAPP,
          externalId: '+919876543210',
          lead: { id: 'lead-1', name: 'Rohan Sharma' },
          messages: [
            {
              id: 'msg-1',
              rawText: 'Hello',
              direction: MessageDirection.INBOUND,
              createdAt: new Date(),
            },
          ],
          _count: { messages: 1 },
        },
      ];

      mockPrisma.conversation.findMany.mockResolvedValue(mockRawConversations);

      const result = await service.findAll(ChannelType.WHATSAPP, 'Rohan');

      expect(mockPrisma.conversation.findMany).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].lastMessage).toEqual(mockRawConversations[0].messages[0]);
      expect(result[0].unreadCount).toBe(1);
    });
  });

  describe('findOne', () => {
    it('should return conversation when found', async () => {
      const mockConv = {
        id: 'conv-1',
        channel: ChannelType.INSTAGRAM,
        externalId: 'ig-12345',
        messages: [{ id: 'msg-1', rawText: 'Is price negotiable?' }],
      };

      mockPrisma.conversation.findUnique.mockResolvedValue(mockConv);

      const result = await service.findOne('conv-1');
      expect(result).toEqual(mockConv);
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('sendMessage', () => {
    it('should create OUTBOUND message and log Interaction if lead exists', async () => {
      const mockConv = {
        id: 'conv-1',
        leadId: 'lead-1',
        channel: ChannelType.WHATSAPP,
      };

      const mockCreatedMsg = {
        id: 'msg-out-1',
        conversationId: 'conv-1',
        direction: MessageDirection.OUTBOUND,
        messageType: MessageType.TEXT,
        rawText: 'Yes, brochure sent!',
        status: MessageStatus.SENT,
      };

      mockPrisma.conversation.findUnique.mockResolvedValue(mockConv);
      mockPrisma.message.create.mockResolvedValue(mockCreatedMsg);
      mockPrisma.conversation.update.mockResolvedValue({ ...mockConv, updatedAt: new Date() });
      mockPrisma.interaction.create.mockResolvedValue({ id: 'int-1' });

      const result = await service.sendMessage('conv-1', 'user-agent-1', {
        rawText: 'Yes, brochure sent!',
      });

      expect(mockPrisma.message.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          conversationId: 'conv-1',
          direction: MessageDirection.OUTBOUND,
          rawText: 'Yes, brochure sent!',
        }),
      });

      expect(mockPrisma.interaction.create).toHaveBeenCalled();
      expect(result).toEqual(mockCreatedMsg);
    });
  });

  describe('markAsRead', () => {
    it('should update unread inbound messages to READ', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({ id: 'conv-1' });
      mockPrisma.message.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.markAsRead('conv-1');

      expect(mockPrisma.message.updateMany).toHaveBeenCalledWith({
        where: {
          conversationId: 'conv-1',
          direction: MessageDirection.INBOUND,
          status: { not: MessageStatus.READ },
        },
        data: { status: MessageStatus.READ },
      });
      expect(result).toEqual({ updated: 2 });
    });
  });
});
