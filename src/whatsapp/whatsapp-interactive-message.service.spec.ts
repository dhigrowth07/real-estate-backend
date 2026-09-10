import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { WhatsAppInteractiveMessageService } from './whatsapp-interactive-message.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelType, MessageDirection, MessageStatus, MessageType } from '@prisma/client';

describe('WhatsAppInteractiveMessageService', () => {
  let service: WhatsAppInteractiveMessageService;
  let prisma: PrismaService;
  let configService: ConfigService;

  const mockPrisma: any = {
    conversation: {
      upsert: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({
          id: 'conv-wa-123',
          channel: ChannelType.WHATSAPP,
          externalId: args.where.channel_externalId.externalId,
          leadId: args.create.leadId,
        }),
      ),
    },
    message: {
      create: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({
          id: 'msg-out-1',
          ...args.data,
        }),
      ),
    },
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'WHATSAPP_API_TOKEN') return 'meta_test_token_999';
      if (key === 'WHATSAPP_PHONE_NUMBER_ID') return '10987654321';
      return null;
    });

    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          messages: [{ id: 'wamid.HBgL_INTERACTIVE_12345' }],
        }),
      } as any),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppInteractiveMessageService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<WhatsAppInteractiveMessageService>(
      WhatsAppInteractiveMessageService,
    );
    prisma = module.get<PrismaService>(PrismaService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendButtonMessage', () => {
    it('should throw BadRequestException if recipient phone number is missing', async () => {
      await expect(
        service.sendButtonMessage('', 'Choose an option', [{ id: '1', title: 'Buy' }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if bodyText is missing', async () => {
      await expect(
        service.sendButtonMessage('+919876543210', '', [{ id: '1', title: 'Buy' }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if buttons array is empty', async () => {
      await expect(
        service.sendButtonMessage('+919876543210', 'Choose an option', []),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if buttons count exceeds 3', async () => {
      const fourButtons = [
        { id: '1', title: 'Apartment' },
        { id: '2', title: 'Villa' },
        { id: '3', title: 'Plot' },
        { id: '4', title: 'Commercial' },
      ];
      await expect(
        service.sendButtonMessage('+919876543210', 'Select property type', fourButtons),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully send interactive button message with 1 to 3 buttons and log to DB', async () => {
      const buttons = [
        { id: 'opt_buy', title: 'Buy Property' },
        { id: 'opt_rent', title: 'Rent Property' },
        { id: 'opt_invest', title: 'Investment' },
      ];

      const result = await service.sendButtonMessage(
        '+919876543210',
        'What is the purpose of your search?',
        buttons,
        {
          headerText: 'Property Requirement',
          footerText: 'Select one of the options below',
          leadId: 'lead-test-1',
        },
      );

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe('wamid.HBgL_INTERACTIVE_12345');
      expect(result.conversationId).toBe('conv-wa-123');
      expect(result.leadId).toBe('lead-test-1');

      // Verify Graph API payload
      expect(global.fetch).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/10987654321/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer meta_test_token_999',
          }),
        }),
      );

      // Verify DB persistence
      expect(mockPrisma.conversation.upsert).toHaveBeenCalledWith({
        where: {
          channel_externalId: {
            channel: ChannelType.WHATSAPP,
            externalId: '+919876543210',
          },
        },
        create: expect.objectContaining({
          channel: ChannelType.WHATSAPP,
          externalId: '+919876543210',
          leadId: 'lead-test-1',
        }),
        update: {
          leadId: 'lead-test-1',
        },
      });

      expect(mockPrisma.message.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          conversationId: 'conv-wa-123',
          direction: MessageDirection.OUTBOUND,
          messageType: MessageType.AUTO_REPLY,
          externalMessageId: 'wamid.HBgL_INTERACTIVE_12345',
          status: MessageStatus.SENT,
        }),
      });
    });

    it('should truncate button title to 20 characters per Meta specification', async () => {
      const longTitleButton = [
        { id: 'btn_long', title: 'Independent House / Villa Super Luxury' },
      ];

      await service.sendButtonMessage('+919876543210', 'Choose:', longTitleButton);

      const fetchCallArgs = (global.fetch as jest.Mock).mock.calls[0];
      const sentPayload = JSON.parse(fetchCallArgs[1].body);

      expect(sentPayload.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20);
      expect(sentPayload.interactive.action.buttons[0].reply.title).toBe('Independent House / ');
    });
  });

  describe('sendListMessage', () => {
    it('should throw BadRequestException if recipient phone number or bodyText is missing', async () => {
      await expect(
        service.sendListMessage('', 'Body', 'Menu', [{ rows: [{ id: '1', title: 'Option 1' }] }]),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.sendListMessage('+919876543210', '', 'Menu', [{ rows: [{ id: '1', title: 'Option 1' }] }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if buttonText or sections are empty', async () => {
      await expect(
        service.sendListMessage('+919876543210', 'Body', '', [{ rows: [{ id: '1', title: 'Option 1' }] }]),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.sendListMessage('+919876543210', 'Body', 'Menu', []),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if total rows across all sections exceeds 10', async () => {
      const elevenRowsSection = [
        {
          title: 'Section 1',
          rows: Array.from({ length: 6 }, (_, i) => ({ id: `row_${i}`, title: `Option ${i}` })),
        },
        {
          title: 'Section 2',
          rows: Array.from({ length: 5 }, (_, i) => ({ id: `row_b_${i}`, title: `Option B ${i}` })),
        },
      ];

      await expect(
        service.sendListMessage('+919876543210', 'Select budget', 'View Budgets', elevenRowsSection),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully send interactive list message with multiple sections and up to 10 rows', async () => {
      const sections = [
        {
          title: 'Residential',
          rows: [
            { id: 'type_apt', title: 'Apartment / Flat', description: 'Gated community flats' },
            { id: 'type_villa', title: 'Villa / House', description: 'Independent villas' },
            { id: 'type_plot', title: 'Plot / Land', description: 'Residential layout' },
          ],
        },
        {
          title: 'Commercial',
          rows: [
            { id: 'type_comm_off', title: 'Office Space', description: 'IT / Commercial office' },
            { id: 'type_comm_shop', title: 'Retail Shop', description: 'Showroom / Retail' },
          ],
        },
      ];

      const result = await service.sendListMessage(
        '+919876543210',
        'Which type of property are you interested in?',
        'Select Type',
        sections,
        {
          headerText: 'Property Type Selection',
          footerText: 'Tap the button to view options',
          leadId: 'lead-test-2',
        },
      );

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe('wamid.HBgL_INTERACTIVE_12345');
      expect(result.leadId).toBe('lead-test-2');

      const fetchCallArgs = (global.fetch as jest.Mock).mock.calls[0];
      const sentPayload = JSON.parse(fetchCallArgs[1].body);

      expect(sentPayload.type).toBe('interactive');
      expect(sentPayload.interactive.type).toBe('list');
      expect(sentPayload.interactive.action.button).toBe('Select Type');
      expect(sentPayload.interactive.action.sections.length).toBe(2);
      expect(sentPayload.interactive.action.sections[0].rows.length).toBe(3);
      expect(sentPayload.interactive.action.sections[1].rows.length).toBe(2);

      // Verify DB persistence
      expect(mockPrisma.message.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          direction: MessageDirection.OUTBOUND,
          messageType: MessageType.AUTO_REPLY,
          externalMessageId: 'wamid.HBgL_INTERACTIVE_12345',
        }),
      });
    });

    it('should fallback gracefully in test/dev environment when no tokens are configured', async () => {
      mockConfigService.get.mockReturnValue(null);

      const result = await service.sendButtonMessage(
        '+919876543210',
        'Hello from test',
        [{ id: '1', title: 'Test' }],
      );

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toContain('wamid.SIMULATED_');
      expect(result.status).toBe(MessageStatus.SENT);
    });
  });
});
