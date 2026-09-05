import { Test, TestingModule } from '@nestjs/testing';
import { WhatsAppTemplateService } from './whatsapp-template.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  TemplateStatus,
  TemplateCategory,
  PropertyType,
  LeadSource,
  LeadStage,
  ChannelType,
  MessageDirection,
  MessageType,
  MessageStatus,
} from '@prisma/client';

describe('WhatsAppTemplateService', () => {
  let service: WhatsAppTemplateService;
  let prisma: PrismaService;
  let configService: ConfigService;

  const mockApprovedTemplate = {
    id: 'tmpl-prop-1',
    name: 'property_details_share',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'IMAGE',
    bodyText:
      'Hello {{1}},\n\nThank you for your interest in {{2}}!\n\n📍 Location: {{3}}\n🏠 Config: {{4}}\n💰 Price: {{5}}\n\nTap below for details:\n{{6}}',
    variables: [
      'lead_name',
      'property_title',
      'location',
      'configuration',
      'price',
      'link',
    ],
    status: TemplateStatus.APPROVED,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrisma = {
    template: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    lead: {
      findUnique: jest.fn(),
    },
    conversation: {
      upsert: jest.fn().mockImplementation((args) =>
        Promise.resolve({ id: 'conv-tmpl-100', ...args.create }),
      ),
    },
    message: {
      create: jest.fn().mockImplementation((args) =>
        Promise.resolve({ id: 'msg-tmpl-100', ...args.data }),
      ),
    },
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'FRONTEND_URL') return 'https://realestatecrm.app';
      if (key === 'WHATSAPP_API_TOKEN') return null; // Use sandbox simulation for tests
      if (key === 'WHATSAPP_PHONE_NUMBER_ID') return null;
      return null;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppTemplateService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<WhatsAppTemplateService>(WhatsAppTemplateService);
    prisma = module.get<PrismaService>(PrismaService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('Hard Guard: verifyWhatsAppOptInGuard', () => {
    it('should throw BadRequestException if lead has no phone number', () => {
      expect(() => {
        service.verifyWhatsAppOptInGuard({
          id: 'lead-no-phone',
          phone: '',
          whatsappOptIn: true,
        });
      }).toThrow(BadRequestException);
    });

    it('should throw BadRequestException if whatsappOptIn is false', () => {
      expect(() => {
        service.verifyWhatsAppOptInGuard({
          id: 'lead-no-optin',
          phone: '+919876543210',
          whatsappOptIn: false,
        });
      }).toThrow(/whatsappOptIn is false/);
    });

    it('should pass if lead has valid phone and whatsappOptIn is true', () => {
      expect(() => {
        service.verifyWhatsAppOptInGuard({
          id: 'lead-valid',
          phone: '+919876543210',
          whatsappOptIn: true,
        });
      }).not.toThrow();
    });
  });

  describe('sendPropertyDetailsTemplate', () => {
    it('should reject if lead does not exist', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(null);

      await expect(service.sendPropertyDetailsTemplate('lead-unknown')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should enforce hard guard and reject if lead whatsappOptIn is false', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({
        id: 'lead-optin-false',
        name: 'Arun',
        phone: '+919876543210',
        whatsappOptIn: false,
        interestedPropertyId: 'prop-1',
        interestedProperty: { id: 'prop-1', title: 'Villa' },
      });

      await expect(service.sendPropertyDetailsTemplate('lead-optin-false')).rejects.toThrow(
        /whatsappOptIn is false/,
      );

      expect(mockPrisma.message.create).not.toHaveBeenCalled();
    });

    it('should reject if lead has no interestedPropertyId linked', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({
        id: 'lead-no-property',
        name: 'Arun',
        phone: '+919876543210',
        whatsappOptIn: true,
        interestedPropertyId: null,
        interestedProperty: null,
      });

      await expect(service.sendPropertyDetailsTemplate('lead-no-property')).rejects.toThrow(
        /no interested property linked/,
      );
    });

    it('should reject if template is not approved', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({
        id: 'lead-ok',
        name: 'Arun',
        phone: '+919876543210',
        whatsappOptIn: true,
        interestedPropertyId: 'prop-1',
        interestedProperty: { id: 'prop-1', title: 'Villa', price: 10000000 },
      });

      mockPrisma.template.findUnique.mockResolvedValue({
        ...mockApprovedTemplate,
        status: TemplateStatus.PENDING,
      });

      await expect(service.sendPropertyDetailsTemplate('lead-ok')).rejects.toThrow(
        /must be APPROVED/,
      );
    });

    it('should successfully send property details template, log outbound message, and return result', async () => {
      const validLead = {
        id: 'lead-valid-1',
        name: 'Sneha Patel',
        phone: '+919876543210',
        whatsappOptIn: true,
        interestedPropertyId: 'prop-villa-101',
        interestedProperty: {
          id: 'prop-villa-101',
          title: 'Palm Greens Luxury Villa',
          location: 'Sarjapur Road, Bangalore',
          propertyType: PropertyType.VILLA,
          bhk: '4 BHK',
          sqft: 3200,
          price: 25000000, // 2.5 Cr
          images: ['https://images.unsplash.com/photo-villa-1.jpg'],
        },
      };

      mockPrisma.lead.findUnique.mockResolvedValue(validLead);
      mockPrisma.template.findUnique.mockResolvedValue(mockApprovedTemplate);

      const result = await service.sendPropertyDetailsTemplate('lead-valid-1');

      expect(result.success).toBe(true);
      expect(result.leadId).toBe('lead-valid-1');
      expect(result.templateName).toBe('property_details_share');
      expect(result.renderedText).toContain('Palm Greens Luxury Villa');
      expect(result.renderedText).toContain('Sarjapur Road, Bangalore');
      expect(result.renderedText).toContain('4 BHK, 3200 sqft');
      expect(result.renderedText).toContain('₹2.50 Cr');
      expect(result.renderedText).toContain('https://realestatecrm.app/properties/prop-villa-101');

      // 1. Conversation upserted for WhatsApp
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
          leadId: 'lead-valid-1',
        }),
        update: expect.objectContaining({
          leadId: 'lead-valid-1',
        }),
      });

      // 2. Outbound Message logged with TEMPLATE type
      expect(mockPrisma.message.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          conversationId: 'conv-tmpl-100',
          direction: MessageDirection.OUTBOUND,
          messageType: MessageType.TEMPLATE,
          status: MessageStatus.SENT,
          rawText: expect.stringContaining('Palm Greens Luxury Villa'),
        }),
      });
    });
  });
});
