import { Test, TestingModule } from '@nestjs/testing';
import { LeadQualificationService, PROPERTY_TYPE_BUTTONS, TIMELINE_BUTTONS } from './lead-qualification.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppInteractiveMessageService } from '../whatsapp/whatsapp-interactive-message.service';
import { BudgetBandService } from '../properties/budget-band.service';
import { MatchesService } from '../matches/matches.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { InstagramMessagesHandler } from '../webhooks/handlers/instagram-messages.handler';
import { InstagramProfileService } from '../webhooks/instagram-profile.service';
import { ConfigService } from '@nestjs/config';
import { MergeLeadsService } from './merge-leads.service';
import { PhoneExtractionService } from '../common/phone/phone-extraction.service';
import { WhatsAppTemplateService } from '../whatsapp/whatsapp-template.service';
import {
  ChannelType,
  LeadQualificationStatus,
  LeadStage,
  LeadUrgency,
  NotificationType,
  OnboardingStep,
  PropertyType,
  UserRole,
} from '@prisma/client';

describe('STAGE QB-9: Lead Qualification Bot Edge Cases & Reliability', () => {
  let qualificationService: LeadQualificationService;
  let budgetBandService: BudgetBandService;
  let instagramHandler: InstagramMessagesHandler;
  let instagramProfileService: InstagramProfileService;

  // Mock Dependencies
  let mockPrisma: any;
  let mockWhatsAppInteractiveService: any;
  let mockMatchesService: any;
  let mockNotificationsGateway: any;
  let mockPhoneExtractionService: any;
  let mockWhatsAppTemplateService: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma = {
      lead: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      conversation: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockImplementation((args: any) =>
          Promise.resolve({ id: 'conv-ig-1', ...(args.create || {}) }),
        ),
        update: jest.fn(),
      },
      property: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
      message: {
        findUnique: jest.fn(),
        create: jest.fn().mockImplementation((args: any) =>
          Promise.resolve({ id: 'msg-ig-1', ...(args.data || {}) }),
        ),
      },
      pendingInterest: {
        findFirst: jest.fn(),
      },
      notification: {
        create: jest.fn().mockImplementation((args: any) =>
          Promise.resolve({ id: 'notif-1', ...args.data }),
        ),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'admin-1', role: UserRole.ADMIN }]),
      },
      interaction: {
        create: jest.fn(),
      },
    };

    mockWhatsAppInteractiveService = {
      sendButtonMessage: jest.fn().mockResolvedValue({
        success: true,
        messageId: 'msg-btn-1',
        externalMessageId: 'wamid.BTN_1',
      }),
      sendListMessage: jest.fn().mockResolvedValue({
        success: true,
        messageId: 'msg-list-1',
        externalMessageId: 'wamid.LIST_1',
      }),
      sendTextMessage: jest.fn().mockResolvedValue({
        success: true,
        messageId: 'msg-txt-1',
        externalMessageId: 'wamid.TXT_1',
      }),
    };

    mockMatchesService = {
      generateMatchesForLead: jest.fn().mockResolvedValue([]),
    };

    mockNotificationsGateway = {
      sendToUser: jest.fn(),
    };

    mockPhoneExtractionService = {
      extractPhoneNumber: jest.fn().mockReturnValue({ found: false, phone: null, confidence: 'NONE' }),
      extractPhone: jest.fn().mockReturnValue(null),
    };

    mockWhatsAppTemplateService = {
      sendBrochureTemplate: jest.fn().mockResolvedValue({ success: true }),
    };

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'META_PAGE_ACCESS_TOKEN' || key === 'INSTAGRAM_ACCESS_TOKEN') return 'test-token';
        return null;
      }),
    };

    const mockMergeLeadsService = {
      mergeLeads: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadQualificationService,
        BudgetBandService,
        InstagramProfileService,
        InstagramMessagesHandler,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: WhatsAppInteractiveMessageService,
          useValue: mockWhatsAppInteractiveService,
        },
        { provide: MatchesService, useValue: mockMatchesService },
        { provide: NotificationsGateway, useValue: mockNotificationsGateway },
        { provide: PhoneExtractionService, useValue: mockPhoneExtractionService },
        { provide: WhatsAppTemplateService, useValue: mockWhatsAppTemplateService },
        { provide: MergeLeadsService, useValue: mockMergeLeadsService },
      ],
    }).compile();

    qualificationService = module.get<LeadQualificationService>(LeadQualificationService);
    budgetBandService = module.get<BudgetBandService>(BudgetBandService);
    instagramProfileService = module.get<InstagramProfileService>(InstagramProfileService);
    instagramHandler = module.get<InstagramMessagesHandler>(InstagramMessagesHandler);
  });

  // =========================================================================
  // SCENARIO 1: Free text during ASK_PROPERTY_TYPE or ASK_TIMELINE
  // =========================================================================
  describe('Scenario 1: Free text replies during button-expected steps', () => {
    it('should clearly re-prompt with property type buttons when receiving free text in ASK_PROPERTY_TYPE without guessing or failing', async () => {
      const mockLead = {
        id: 'lead-free-1',
        name: 'Amit Patel',
        phone: '+919876543210',
        propertyType: null,
        budgetMin: null,
        budgetMax: null,
        preferredLocations: [],
        urgency: null,
        qualificationStatus: LeadQualificationStatus.IN_PROGRESS,
      };

      const mockConv = {
        id: 'conv-1',
        leadId: mockLead.id,
        channel: ChannelType.WHATSAPP,
        externalId: mockLead.phone,
        onboardingStep: OnboardingStep.ASK_PROPERTY_TYPE,
        lead: mockLead,
      };

      mockPrisma.conversation.findUnique.mockResolvedValue(mockConv);
      mockPrisma.conversation.update.mockResolvedValue(mockConv);

      const result = await qualificationService.handleReply(
        'conv-1',
        'I am not sure, maybe looking for a 2BHK flat or something',
      );

      expect(result.handled).toBe(true);
      expect(result.reprompted).toBe(true);
      expect(result.onboardingStep).toBe(OnboardingStep.ASK_PROPERTY_TYPE);

      // Lead.propertyType should NOT be updated or guessed
      expect(mockPrisma.lead.update).not.toHaveBeenCalled();

      // Should re-send the property type buttons with a helpful prompt
      expect(mockWhatsAppInteractiveService.sendButtonMessage).toHaveBeenCalledWith(
        mockLead.phone,
        expect.stringContaining('choose your preferred property type'),
        PROPERTY_TYPE_BUTTONS,
        expect.objectContaining({
          leadId: mockLead.id,
        }),
      );
    });

    it('should clearly re-prompt with timeline buttons when receiving free text in ASK_TIMELINE without guessing or failing', async () => {
      const mockLead = {
        id: 'lead-free-2',
        name: 'Sneha Roy',
        phone: '+919876543211',
        propertyType: PropertyType.APARTMENT,
        budgetMin: 5000000,
        budgetMax: 10000000,
        preferredLocations: ['Whitefield'],
        urgency: null,
        qualificationStatus: LeadQualificationStatus.IN_PROGRESS,
      };

      const mockConv = {
        id: 'conv-2',
        leadId: mockLead.id,
        channel: ChannelType.WHATSAPP,
        externalId: mockLead.phone,
        onboardingStep: OnboardingStep.ASK_TIMELINE,
        lead: mockLead,
      };

      mockPrisma.conversation.findUnique.mockResolvedValue(mockConv);
      mockPrisma.conversation.update.mockResolvedValue(mockConv);

      const result = await qualificationService.handleReply(
        'conv-2',
        'Planning to move in sometime next year after monsoon',
      );

      expect(result.handled).toBe(true);
      expect(result.reprompted).toBe(true);
      expect(result.onboardingStep).toBe(OnboardingStep.ASK_TIMELINE);

      // Urgency should not be updated with fake data
      expect(mockPrisma.lead.update).not.toHaveBeenCalled();

      // Should re-send the timeline buttons with a helpful prompt
      expect(mockWhatsAppInteractiveService.sendButtonMessage).toHaveBeenCalledWith(
        mockLead.phone,
        expect.stringContaining('timeline options below'),
        TIMELINE_BUTTONS,
        expect.objectContaining({
          leadId: mockLead.id,
        }),
      );
    });
  });

  // =========================================================================
  // SCENARIO 2: Lead types "agent" partway through (after answering 2 of 4)
  // =========================================================================
  describe('Scenario 2: "agent" keyword partway through qualification flow', () => {
    it('should preserve existing 2/4 answers on Lead, set REQUESTED_AGENT status, and send no further automated questions', async () => {
      const mockLead = {
        id: 'lead-partway-1',
        name: 'Vikas Gupta',
        phone: '+919876543212',
        propertyType: PropertyType.APARTMENT, // Answer 1 preserved
        budgetMin: 7500000,                    // Answer 2 preserved
        budgetMax: 12500000,                   // Answer 2 preserved
        preferredLocations: [],
        urgency: null,
        qualificationStatus: LeadQualificationStatus.IN_PROGRESS,
        assignedAgentId: 'agent-123',
      };

      const mockConv = {
        id: 'conv-partway-1',
        leadId: mockLead.id,
        channel: ChannelType.WHATSAPP,
        externalId: mockLead.phone,
        onboardingStep: OnboardingStep.ASK_LOCATION, // At Step 3
        lead: mockLead,
      };

      mockPrisma.conversation.findUnique.mockResolvedValue(mockConv);
      mockPrisma.conversation.update.mockResolvedValue({
        ...mockConv,
        onboardingStep: OnboardingStep.COMPLETE,
      });
      mockPrisma.lead.update.mockResolvedValue({
        ...mockLead,
        qualificationStatus: LeadQualificationStatus.REQUESTED_AGENT,
      });

      const result = await qualificationService.handleReply(
        'conv-partway-1',
        'Can I talk to a real human agent please?',
      );

      expect(result.handled).toBe(true);
      expect(result.onboardingStep).toBe(OnboardingStep.COMPLETE);
      expect(result.status).toBe(LeadQualificationStatus.REQUESTED_AGENT);

      // 1. Lead qualification status must become REQUESTED_AGENT
      expect(mockPrisma.lead.update).toHaveBeenCalledWith({
        where: { id: mockLead.id },
        data: {
          qualificationStatus: LeadQualificationStatus.REQUESTED_AGENT,
        },
      });

      // 2. Conversation onboardingStep must be set to COMPLETE
      expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
        where: { id: mockConv.id },
        data: {
          onboardingStep: OnboardingStep.COMPLETE,
        },
      });

      // 3. Notification alert sent to agent and admins
      expect(mockPrisma.notification.create).toHaveBeenCalled();
      expect(mockNotificationsGateway.sendToUser).toHaveBeenCalled();

      // 4. Confirmation message sent explaining takeover
      expect(mockWhatsAppInteractiveService.sendTextMessage).toHaveBeenCalledWith(
        mockLead.phone,
        expect.stringContaining('paused the automated questions'),
        expect.objectContaining({
          leadId: mockLead.id,
        }),
      );

      // 5. NO automated questions (buttons or list) sent
      expect(mockWhatsAppInteractiveService.sendButtonMessage).not.toHaveBeenCalled();
      expect(mockWhatsAppInteractiveService.sendListMessage).not.toHaveBeenCalled();

      // 6. Matching engine should not be triggered prematurely
      expect(mockMatchesService.generateMatchesForLead).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // SCENARIO 3: Rapid consecutive messages from the same lead
  // =========================================================================
  describe('Scenario 3: Two rapid messages in quick succession', () => {
    it('should process the first message transition then process the second message without corrupting onboardingStep', async () => {
      const mockLead = {
        id: 'lead-rapid-1',
        name: 'Kavita Menon',
        phone: '+919876543213',
        propertyType: null,
        budgetMin: null,
        budgetMax: null,
        preferredLocations: [],
        urgency: null,
        qualificationStatus: LeadQualificationStatus.IN_PROGRESS,
      };

      const mockConv = {
        id: 'conv-rapid-1',
        leadId: mockLead.id,
        channel: ChannelType.WHATSAPP,
        externalId: mockLead.phone,
        onboardingStep: OnboardingStep.ASK_PROPERTY_TYPE,
        lead: mockLead,
      };

      // Message 1: Lead taps "prop_type_apartment" button
      mockPrisma.conversation.findUnique.mockResolvedValueOnce(mockConv);
      mockPrisma.lead.update.mockResolvedValueOnce({
        ...mockLead,
        propertyType: PropertyType.APARTMENT,
      });
      mockPrisma.conversation.update.mockResolvedValueOnce({
        ...mockConv,
        onboardingStep: OnboardingStep.ASK_BUDGET,
      });

      const res1 = await qualificationService.handleReply('conv-rapid-1', 'prop_type_apartment');

      expect(res1.handled).toBe(true);
      expect(res1.advancedTo).toBe(OnboardingStep.ASK_BUDGET);
      expect(mockPrisma.lead.update).toHaveBeenCalledWith({
        where: { id: mockLead.id },
        data: { propertyType: PropertyType.APARTMENT },
      });

      // Message 2: Immediate rapid text message ("near metro station please") arriving right after
      const updatedConv = {
        ...mockConv,
        onboardingStep: OnboardingStep.ASK_BUDGET,
        lead: { ...mockLead, propertyType: PropertyType.APARTMENT },
      };
      mockPrisma.conversation.findUnique.mockResolvedValueOnce(updatedConv);
      mockPrisma.conversation.update.mockResolvedValueOnce(updatedConv);

      const res2 = await qualificationService.handleReply('conv-rapid-1', 'near metro station please');

      expect(res2.handled).toBe(true);
      expect(res2.reprompted).toBe(true);
      expect(res2.onboardingStep).toBe(OnboardingStep.ASK_BUDGET);

      // Second message is cleanly handled by re-prompting budget options rather than corrupting state
      expect(mockWhatsAppInteractiveService.sendListMessage).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // SCENARIO 4: Property inventory is too small for BudgetBandService
  // =========================================================================
  describe('Scenario 4: Fallback budget bands on sparse inventory', () => {
    it('should generate sensible default fallback bands when property inventory has 0 or 1 listing and not break the flow', async () => {
      // 0 properties in DB
      mockPrisma.property.findMany.mockResolvedValue([]);

      const bandsEmpty = await budgetBandService.generateBudgetBands();

      expect(bandsEmpty.length).toBeGreaterThanOrEqual(4);
      expect(bandsEmpty[0].label).toContain('Under ₹50');
      expect(bandsEmpty[0].min).toBe(0);
      expect(bandsEmpty[0].max).toBe(5000000);

      // Flow integration test with empty DB fallback
      const mockLead = {
        id: 'lead-sparse-1',
        name: 'Deepak Verma',
        phone: '+919876543214',
        propertyType: PropertyType.APARTMENT,
        qualificationStatus: LeadQualificationStatus.IN_PROGRESS,
      };
      const mockConv = {
        id: 'conv-sparse-1',
        leadId: mockLead.id,
        channel: ChannelType.WHATSAPP,
        externalId: mockLead.phone,
        onboardingStep: OnboardingStep.ASK_PROPERTY_TYPE,
        lead: mockLead,
      };

      mockPrisma.conversation.findUnique.mockResolvedValue(mockConv);
      mockPrisma.lead.update.mockResolvedValue(mockLead);
      mockPrisma.conversation.update.mockResolvedValue({
        ...mockConv,
        onboardingStep: OnboardingStep.ASK_BUDGET,
      });

      const replyRes = await qualificationService.handleReply('conv-sparse-1', 'prop_type_apartment');

      expect(replyRes.handled).toBe(true);
      expect(replyRes.advancedTo).toBe(OnboardingStep.ASK_BUDGET);
      expect(mockWhatsAppInteractiveService.sendListMessage).toHaveBeenCalledWith(
        mockLead.phone,
        expect.stringContaining('planned budget range'),
        'Select Budget',
        expect.arrayContaining([
          expect.objectContaining({
            title: 'Available Price Ranges',
            rows: expect.arrayContaining([
              expect.objectContaining({ id: 'budget_band_under_50l' }),
            ]),
          }),
        ]),
        expect.objectContaining({
          leadId: mockLead.id,
        }),
      );
    });
  });

  // =========================================================================
  // SCENARIO 5: Instagram profile fetch fails
  // =========================================================================
  describe('Scenario 5: Instagram profile fetch failure resilience', () => {
    it('should create Lead with null name (not placeholder or crash) when Instagram profile API throws an error and no username exists', async () => {
      jest.spyOn(instagramProfileService, 'getProfile').mockResolvedValue({
        name: null,
        username: null,
        profilePic: null,
      });

      mockPrisma.lead.findUnique.mockResolvedValue(null); // No existing lead
      mockPrisma.pendingInterest.findFirst.mockResolvedValue(null);
      mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv-ig-1' });

      mockPrisma.lead.create.mockImplementation((args: any) =>
        Promise.resolve({
          id: 'lead-new-ig-1',
          ...args.data,
        }),
      );

      const event = {
        sender: { id: 'ig-user-fail-1' },
        recipient: { id: 'ig-page-1' },
        message: {
          mid: 'm_fail_123',
          text: 'Hi I am interested in properties',
        },
      };

      const handledResult = await instagramHandler.handleInboundDm(event);

      expect(handledResult).toBeDefined();
      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            instagramUserId: 'ig-user-fail-1',
            name: null, // Strictly null, NO fake placeholder string!
            source: 'INSTAGRAM',
            qualificationStatus: LeadQualificationStatus.UNQUALIFIED,
          }),
        }),
      );
    });

    it('should create Lead with @username when Instagram profile API fails but username is available in prior comments or payload', async () => {
      jest.spyOn(instagramProfileService, 'getProfile').mockResolvedValue({
        name: null,
        username: 'property_seeker_99',
        profilePic: null,
      });

      mockPrisma.lead.findUnique.mockResolvedValue(null);
      mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv-ig-2' });

      mockPrisma.lead.create.mockImplementation((args: any) =>
        Promise.resolve({
          id: 'lead-new-ig-2',
          ...args.data,
        }),
      );

      const event = {
        sender: { id: 'ig-user-user-2', username: 'property_seeker_99' },
        recipient: { id: 'ig-page-1' },
        message: {
          mid: 'm_user_456',
          text: 'Hello do you have 3BHKs in Koramangala?',
        },
      };

      const handledResult = await instagramHandler.handleInboundDm(event);

      expect(handledResult).toBeDefined();
      expect(mockPrisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            instagramUserId: 'ig-user-user-2',
            name: '@property_seeker_99', // Uses real username rather than guessing
            source: 'INSTAGRAM',
            qualificationStatus: LeadQualificationStatus.UNQUALIFIED,
          }),
        }),
      );
    });
  });
});
