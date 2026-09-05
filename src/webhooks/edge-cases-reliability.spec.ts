import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InstagramCommentsHandler } from './handlers/instagram-comments.handler';
import { InstagramMessagesHandler } from './handlers/instagram-messages.handler';
import { WhatsAppMessagesHandler } from './handlers/whatsapp-messages.handler';
import { MergeLeadsService } from '../leads/merge-leads.service';
import { WhatsAppTemplateService } from '../whatsapp/whatsapp-template.service';
import { PhoneExtractionService } from '../common/phone/phone-extraction.service';
import { MatchesService } from '../matches/matches.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ChannelType,
  LeadSource,
  LeadStage,
  MessageDirection,
  MessageStatus,
  MessageType,
} from '@prisma/client';

import { ConfigService } from '@nestjs/config';

describe('STAGE P2-15 — Edge Case & Reliability End-to-End Test Suite', () => {
  let commentsHandler: InstagramCommentsHandler;
  let instagramDmHandler: InstagramMessagesHandler;
  let whatsappHandler: WhatsAppMessagesHandler;
  let mergeLeadsService: MergeLeadsService;
  let whatsAppTemplateService: WhatsAppTemplateService;
  let phoneExtractionService: PhoneExtractionService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'META_WHATSAPP_PHONE_NUMBER_ID') return '10001234567890';
      if (key === 'META_WHATSAPP_ACCESS_TOKEN') return 'EAAG_test_token';
      return null;
    }),
  };

  const mockPrisma: any = {
    pendingInterest: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    postPropertyMapping: {
      findFirst: jest.fn(),
    },
    message: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    lead: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    conversation: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    property: {
      findUnique: jest.fn(),
    },
    interaction: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    match: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    template: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 'admin-user-1', name: 'Admin', role: 'ADMIN' }),
      findUnique: jest.fn(),
    },
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    },
    $transaction: jest.fn(async (cb) => cb(mockPrisma)),
  };

  const mockMatchesService = {
    createExplicitMatch: jest.fn().mockResolvedValue({ id: 'match-explicit-1', score: 100 }),
    generateMatchesForLead: jest.fn().mockResolvedValue([]),
    generateMatchesForProperty: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstagramCommentsHandler,
        InstagramMessagesHandler,
        WhatsAppMessagesHandler,
        MergeLeadsService,
        WhatsAppTemplateService,
        PhoneExtractionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MatchesService, useValue: mockMatchesService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    commentsHandler = module.get<InstagramCommentsHandler>(InstagramCommentsHandler);
    instagramDmHandler = module.get<InstagramMessagesHandler>(InstagramMessagesHandler);
    whatsappHandler = module.get<WhatsAppMessagesHandler>(WhatsAppMessagesHandler);
    mergeLeadsService = module.get<MergeLeadsService>(MergeLeadsService);
    whatsAppTemplateService = module.get<WhatsAppTemplateService>(WhatsAppTemplateService);
    phoneExtractionService = module.get<PhoneExtractionService>(PhoneExtractionService);

    jest.clearAllMocks();
  });

  // ============================================================================
  // Scenario 1: Meta retries the same webhook payload
  // ============================================================================
  describe('Scenario 1: Meta Webhook Retries & Deduplication', () => {
    it('1.1: Meta retries same Instagram comment — should return existing PendingInterest and not duplicate', async () => {
      const existingPending = {
        id: 'pi-existing-1',
        commentId: 'comment-dup-100',
        instagramUserId: 'ig-user-1',
        propertyId: 'prop-1',
        commentText: 'Price please?',
        resolved: false,
      };

      mockPrisma.pendingInterest.findUnique.mockResolvedValue(existingPending);

      const result = await commentsHandler.handleCommentEvent({
        id: 'comment-dup-100',
        from: { id: 'ig-user-1', username: 'john_doe' },
        media: { id: 'media-post-1' },
        text: 'Price please?',
      });

      expect(mockPrisma.pendingInterest.findUnique).toHaveBeenCalledWith({
        where: { commentId: 'comment-dup-100' },
      });
      expect(mockPrisma.pendingInterest.create).not.toHaveBeenCalled();
      expect(result).toEqual(existingPending);
    });

    it('1.2: Meta retries same Instagram DM message — should skip duplicate processing and create 0 duplicate messages', async () => {
      const existingMessage = {
        id: 'msg-existing-1',
        externalMessageId: 'mid.duplicate.12345',
        conversationId: 'conv-1',
        rawText: '9876543210',
        direction: MessageDirection.INBOUND,
      };

      mockPrisma.message.findUnique.mockResolvedValue(existingMessage);

      const result = await instagramDmHandler.handleInboundDm({
        sender: { id: 'ig-user-1' },
        message: {
          mid: 'mid.duplicate.12345',
          text: '9876543210',
        },
      });

      expect(mockPrisma.message.findUnique).toHaveBeenCalledWith({
        where: { externalMessageId: 'mid.duplicate.12345' },
      });
      expect(mockPrisma.message.create).not.toHaveBeenCalled();
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('1.3: Meta retries same WhatsApp message — should skip duplicate processing and create 0 duplicate messages', async () => {
      const existingMessage = {
        id: 'msg-wa-existing-1',
        externalMessageId: 'wamid.duplicate.99999',
        conversationId: 'conv-wa-1',
        rawText: 'Interested in 3 BHK',
        direction: MessageDirection.INBOUND,
      };

      mockPrisma.message.findUnique.mockResolvedValue(existingMessage);

      const result = await whatsappHandler.handleInboundMessage({
        from: '919876543210',
        id: 'wamid.duplicate.99999',
        type: 'text',
        text: { body: 'Interested in 3 BHK' },
      });

      expect(mockPrisma.message.findUnique).toHaveBeenCalledWith({
        where: { externalMessageId: 'wamid.duplicate.99999' },
      });
      expect(mockPrisma.message.create).not.toHaveBeenCalled();
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // Scenario 2: Phone number in PUBLIC comment
  // ============================================================================
  describe('Scenario 2: Phone Number in Public Comment vs Private DM Privacy Guard', () => {
    it('2.1: Public comment containing phone number is saved as text but never parsed into Lead phone or opt-in', async () => {
      mockPrisma.pendingInterest.findUnique.mockResolvedValue(null);
      mockPrisma.postPropertyMapping.findFirst.mockResolvedValue({
        id: 'map-1',
        instagramMediaId: 'media-reel-88',
        propertyId: 'prop-villa-1',
        property: { id: 'prop-villa-1', title: 'Luxury Villa' },
      });

      const commentWithPhone = 'Call me on 9876543210 for details!';
      const createdPendingInterest = {
        id: 'pi-public-1',
        commentId: 'comment-with-phone-1',
        instagramUserId: 'ig-public-commenter',
        commenterUsername: 'public_user',
        propertyId: 'prop-villa-1',
        commentText: commentWithPhone,
        resolved: false,
      };

      mockPrisma.pendingInterest.create.mockResolvedValue(createdPendingInterest);

      const result = await commentsHandler.handleCommentEvent({
        id: 'comment-with-phone-1',
        from: { id: 'ig-public-commenter', username: 'public_user' },
        media: { id: 'media-reel-88' },
        text: commentWithPhone,
      });

      // Confirm PendingInterest is created with raw text for correlation
      expect(mockPrisma.pendingInterest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          commentText: commentWithPhone,
          propertyId: 'prop-villa-1',
        }),
      });

      // Confirm comments handler NEVER touches Lead or creates phone record in DB
      expect(mockPrisma.lead.create).not.toHaveBeenCalled();
      expect(mockPrisma.lead.update).not.toHaveBeenCalled();
      expect(result?.commentText).toBe(commentWithPhone);
    });
  });

  // ============================================================================
  // Scenario 3: Multiple Comments on Different Properties within 48h
  // ============================================================================
  describe('Scenario 3: Multiple Comments on Different Properties Before Replying Phone', () => {
    it('3.1: Lead comments on 2 properties before sending phone — picks most recent, marks confirmation check, resolves both', async () => {
      const igUserId = 'ig-multi-commenter';

      // Mock existing Unqualified Lead
      const mockLead = {
        id: 'lead-multi-1',
        name: 'Instagram User (4321)',
        phone: '',
        instagramUserId: igUserId,
        stage: LeadStage.UNQUALIFIED,
        sources: ['Instagram'],
        interestedPropertyId: null,
      };

      const updatedLead = {
        ...mockLead,
        phone: '+919876543210',
        stage: LeadStage.NEW,
        whatsappOptIn: true,
        interestedPropertyId: 'prop-B',
        interestedProperty: {
          id: 'prop-B',
          title: 'Skyline Penthouse',
          price: 15000000,
          location: 'Downtown',
          propertyType: 'APARTMENT',
          bhk: '3 BHK',
        },
      };

      mockPrisma.lead.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === mockLead.id) {
          return Promise.resolve(updatedLead);
        }
        if (where.instagramUserId === igUserId) {
          return Promise.resolve(mockLead);
        }
        return Promise.resolve(null);
      });

      mockPrisma.lead.update.mockResolvedValue(updatedLead);
      mockPrisma.message.findUnique.mockResolvedValue(null);
      mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv-multi-1', leadId: mockLead.id });
      mockPrisma.message.create.mockResolvedValue({
        id: 'msg-dm-phone',
        conversationId: 'conv-multi-1',
        rawText: 'My whatsapp is 9876543210',
        direction: MessageDirection.INBOUND,
      });

      // 2 comments in last 48h: Property B is newest (index 0), Property A is older (index 1)
      const pendingComments = [
        {
          id: 'pi-prop-B',
          instagramUserId: igUserId,
          propertyId: 'prop-B',
          property: { id: 'prop-B', title: 'Skyline Penthouse', location: 'Downtown' },
          createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 mins ago
        },
        {
          id: 'pi-prop-A',
          instagramUserId: igUserId,
          propertyId: 'prop-A',
          property: { id: 'prop-A', title: 'Palm Residency', location: 'Westside' },
          createdAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
        },
      ];

      mockPrisma.pendingInterest.findMany.mockResolvedValue(pendingComments);
      mockPrisma.pendingInterest.updateMany.mockResolvedValue({ count: 2 });

      // Mock property for WhatsApp template send
      mockPrisma.property.findUnique.mockResolvedValue({
        id: 'prop-B',
        title: 'Skyline Penthouse',
        price: 15000000,
        location: 'Downtown',
      });

      // Merge check (no duplicate exists)
      mockPrisma.lead.findMany.mockResolvedValue([]);
      mockPrisma.lead.findFirst.mockResolvedValue(null);

      const result = await instagramDmHandler.handleInboundDm({
        sender: { id: igUserId },
        message: {
          mid: 'mid.dm.1001',
          text: 'My whatsapp is 98765 43210',
        },
      });

      // Confirm most recent property (prop-B) was chosen
      expect(result?.interestedPropertyId).toBe('prop-B');
      expect(result?.phoneExtracted).toBe(true);
      expect(result?.phone).toBe('+919876543210');

      // Confirm both pending interests were resolved
      expect(mockPrisma.pendingInterest.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['pi-prop-B', 'pi-prop-A'] } },
        data: { resolved: true },
      });

      // Confirm explicit high-confidence match was created for prop-B
      expect(mockMatchesService.createExplicitMatch).toHaveBeenCalledWith(
        mockLead.id,
        'prop-B',
      );
    });
  });

  // ============================================================================
  // Scenario 4: Invalid/Unparseable Phone Number in DM
  // ============================================================================
  describe('Scenario 4: Invalid / Unparseable Number in DM', () => {
    it('4.1: Message with no valid phone number keeps lead UNQUALIFIED and attempts 0 outbound WhatsApp sends', async () => {
      const igUserId = 'ig-no-phone-user';

      const mockLead = {
        id: 'lead-unqual-1',
        name: 'Instagram User (9999)',
        phone: '',
        instagramUserId: igUserId,
        stage: LeadStage.UNQUALIFIED,
        sources: ['Instagram'],
        interestedPropertyId: null,
      };

      mockPrisma.message.findUnique.mockResolvedValue(null);
      mockPrisma.lead.findUnique.mockResolvedValue(mockLead);
      mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv-unqual-1', leadId: mockLead.id });
      mockPrisma.message.create.mockResolvedValue({
        id: 'msg-invalid-phone',
        conversationId: 'conv-unqual-1',
        rawText: 'Hello is this still available? Budget is 80 lakhs',
        direction: MessageDirection.INBOUND,
      });

      const result = await instagramDmHandler.handleInboundDm({
        sender: { id: igUserId },
        message: {
          mid: 'mid.dm.invalid.phone',
          text: 'Hello is this still available? Budget is 80 lakhs',
        },
      });

      expect(result?.phoneExtracted).toBe(false);
      expect(result?.whatsappDeliveryEligible).toBe(false);
      expect(result?.whatsappDelivered).toBe(false);

      // Lead remains UNQUALIFIED, stage is not updated to NEW
      expect(mockPrisma.lead.update).not.toHaveBeenCalled();
      expect(mockMatchesService.createExplicitMatch).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Scenario 5: Cross-Channel Lead Merge (Phone Call + Instagram)
  // ============================================================================
  describe('Scenario 5: Cross-Channel Lead Merge with Full History Preserved', () => {
    it('5.1: Merges Instagram lead into existing Phone Call lead, combining sources and reassigning touchpoints', async () => {
      const phone = '+919876543210';

      const olderCallLead = {
        id: 'lead-primary-call',
        name: 'Vikram Mehta',
        phone: phone,
        source: LeadSource.DIRECT_CALL,
        sources: ['DIRECT_CALL'],
        stage: LeadStage.CONTACTED,
        interestedPropertyId: null,
        createdAt: new Date('2026-09-01T10:00:00Z'),
      };

      const newerIgLead = {
        id: 'lead-secondary-ig',
        name: 'Instagram User (3210)',
        phone: phone,
        source: LeadSource.INSTAGRAM,
        sources: ['Instagram'],
        stage: LeadStage.NEW,
        interestedPropertyId: 'prop-villa-10',
        instagramUserId: 'ig-user-vikram',
        createdAt: new Date('2026-09-05T10:00:00Z'),
      };

      // Mock finding duplicate lead by normalized phone
      mockPrisma.lead.findUnique.mockResolvedValue(newerIgLead);
      mockPrisma.lead.findFirst.mockResolvedValue(olderCallLead);
      mockPrisma.lead.findMany.mockResolvedValue([olderCallLead]);

      mockPrisma.interaction.updateMany.mockResolvedValue({ count: 3 });
      mockPrisma.conversation.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.match.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.match.updateMany.mockResolvedValue({ count: 1 });

      const updatedPrimary = {
        ...olderCallLead,
        sources: ['DIRECT_CALL', 'Instagram'],
        instagramUserId: 'ig-user-vikram',
        interestedPropertyId: 'prop-villa-10',
      };

      mockPrisma.lead.update.mockImplementation(({ where, data }: any) => {
        if (where.id === olderCallLead.id) {
          return Promise.resolve(updatedPrimary);
        }
        if (where.id === newerIgLead.id) {
          return Promise.resolve({ ...newerIgLead, deletedAt: new Date() });
        }
        return Promise.resolve(data);
      });

      const mergeResult = await mergeLeadsService.mergeLeadByPhone(
        newerIgLead.id,
        phone,
      );

      expect(mergeResult.merged).toBe(true);
      expect(mergeResult.primaryLead.id).toBe(olderCallLead.id);
      expect(mergeResult.primaryLead.sources).toContain('DIRECT_CALL');
      expect(mergeResult.primaryLead.sources).toContain('Instagram');

      // Confirm conversations & interactions were migrated to primary
      expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
        where: { leadId: newerIgLead.id },
        data: { leadId: olderCallLead.id },
      });

      expect(mockPrisma.interaction.updateMany).toHaveBeenCalledWith({
        where: { leadId: newerIgLead.id },
        data: { leadId: olderCallLead.id },
      });

      // Confirm secondary duplicate lead was soft-deleted
      expect(mockPrisma.lead.update).toHaveBeenCalledWith({
        where: { id: newerIgLead.id },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      });
    });
  });

  // ============================================================================
  // Scenario 6: WhatsAppTemplateService Opt-In Hard Guard
  // ============================================================================
  describe('Scenario 6: WhatsAppTemplateService Service-Level Opt-In Hard Guard', () => {
    it('6.1: Service strictly blocks sendPropertyDetailsTemplate when whatsappOptIn is false', async () => {
      const nonOptedInLead = {
        id: 'lead-no-consent',
        name: 'Arjun Verma',
        phone: '+919876543210',
        whatsappOptIn: false,
        whatsappOptInEvidence: null,
        interestedPropertyId: 'prop-1',
        interestedProperty: { id: 'prop-1', title: 'Grand Residency' },
      };

      mockPrisma.lead.findUnique.mockResolvedValue(nonOptedInLead);

      await expect(
        whatsAppTemplateService.sendPropertyDetailsTemplate('lead-no-consent'),
      ).rejects.toThrow(BadRequestException);

      // Verify no message or outbound WhatsApp dispatch was performed
      expect(mockPrisma.message.create).not.toHaveBeenCalled();
    });

    it('6.2: Service strictly blocks sendTemplate if lead has no phone number', async () => {
      const noPhoneLead = {
        id: 'lead-no-phone',
        name: 'Anonymous Lead',
        phone: '',
        whatsappOptIn: true, // opt-in flag true but missing phone number
        interestedPropertyId: 'prop-1',
      };

      mockPrisma.lead.findUnique.mockResolvedValue(noPhoneLead);

      await expect(
        whatsAppTemplateService.sendPropertyDetailsTemplate('lead-no-phone'),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.message.create).not.toHaveBeenCalled();
    });
  });
});
