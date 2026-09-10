import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { LeadQualificationService, PROPERTY_TYPE_BUTTONS, TIMELINE_BUTTONS } from './lead-qualification.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppInteractiveMessageService } from '../whatsapp/whatsapp-interactive-message.service';
import { BudgetBandService } from '../properties/budget-band.service';
import { MatchesService } from '../matches/matches.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
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

describe('LeadQualificationService', () => {
  let service: LeadQualificationService;
  let prisma: PrismaService;
  let whatsAppInteractiveService: WhatsAppInteractiveMessageService;
  let budgetBandService: BudgetBandService;
  let matchesService: MatchesService;
  let notificationsGateway: NotificationsGateway;

  const mockLead = {
    id: 'lead-test-1',
    name: 'Rahul Sharma',
    phone: '+919876543210',
    email: 'rahul@example.com',
    qualificationStatus: LeadQualificationStatus.UNQUALIFIED,
    stage: LeadStage.NEW,
    assignedAgentId: 'agent-1',
  };

  const mockBudgetBands = [
    { id: 'band_0', label: 'Under ₹50 L', min: 0, max: 5000000 },
    { id: 'band_1', label: '₹50 L - ₹1 Cr', min: 5000000, max: 10000000 },
    { id: 'band_2', label: '₹1 Cr - ₹2 Cr', min: 10000000, max: 20000000 },
    { id: 'band_3', label: '₹2 Cr+', min: 20000000, max: null },
  ];

  const mockPrisma: any = {
    lead: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    conversation: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    notification: {
      create: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({ id: 'notif-1', ...args.data }),
      ),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }]),
    },
  };

  const mockWhatsAppInteractiveService: any = {
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

  const mockBudgetBandService: any = {
    generateBudgetBands: jest.fn().mockResolvedValue(mockBudgetBands),
  };

  const mockMatchesService: any = {
    generateMatchesForLead: jest.fn().mockResolvedValue([]),
  };

  const mockNotificationsGateway: any = {
    sendToUser: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadQualificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WhatsAppInteractiveMessageService, useValue: mockWhatsAppInteractiveService },
        { provide: BudgetBandService, useValue: mockBudgetBandService },
        { provide: MatchesService, useValue: mockMatchesService },
        { provide: NotificationsGateway, useValue: mockNotificationsGateway },
      ],
    }).compile();

    service = module.get<LeadQualificationService>(LeadQualificationService);
    prisma = module.get<PrismaService>(PrismaService);
    whatsAppInteractiveService = module.get<WhatsAppInteractiveMessageService>(
      WhatsAppInteractiveMessageService,
    );
    budgetBandService = module.get<BudgetBandService>(BudgetBandService);
    matchesService = module.get<MatchesService>(MatchesService);
    notificationsGateway = module.get<NotificationsGateway>(NotificationsGateway);
  });

  describe('startQualification', () => {
    it('should throw NotFoundException if lead does not exist', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(null);

      await expect(service.startQualification('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if lead has no phone number', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue({
        ...mockLead,
        phone: '',
      });

      await expect(service.startQualification(mockLead.id)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should initialize conversation to ASK_PROPERTY_TYPE, set status IN_PROGRESS, and send property type buttons', async () => {
      mockPrisma.lead.findUnique.mockResolvedValue(mockLead);
      mockPrisma.conversation.upsert.mockResolvedValue({
        id: 'conv-123',
        channel: ChannelType.WHATSAPP,
        externalId: mockLead.phone,
        leadId: mockLead.id,
        onboardingStep: OnboardingStep.ASK_PROPERTY_TYPE,
      });
      mockPrisma.lead.update.mockResolvedValue({
        ...mockLead,
        qualificationStatus: LeadQualificationStatus.IN_PROGRESS,
      });

      const result = await service.startQualification(mockLead.id);

      expect(result.success).toBe(true);
      expect(result.onboardingStep).toBe(OnboardingStep.ASK_PROPERTY_TYPE);

      expect(mockPrisma.lead.update).toHaveBeenCalledWith({
        where: { id: mockLead.id },
        data: { qualificationStatus: LeadQualificationStatus.IN_PROGRESS },
      });

      expect(mockWhatsAppInteractiveService.sendButtonMessage).toHaveBeenCalledWith(
        mockLead.phone,
        expect.stringContaining('What type of property are you looking for?'),
        PROPERTY_TYPE_BUTTONS,
        expect.objectContaining({
          leadId: mockLead.id,
        }),
      );
    });
  });

  describe('Full Successful Qualification Sequence', () => {
    it('should complete full 4-step sequence from ASK_PROPERTY_TYPE -> QUALIFIED and trigger matching engine', async () => {
      // Step 1: ASK_PROPERTY_TYPE
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-123',
        leadId: mockLead.id,
        lead: { ...mockLead },
        onboardingStep: OnboardingStep.ASK_PROPERTY_TYPE,
      });

      const step1Result = await service.handleReply('conv-123', {
        buttonId: 'prop_type_apartment',
      });

      expect(step1Result.handled).toBe(true);
      expect(step1Result.advancedTo).toBe(OnboardingStep.ASK_BUDGET);
      expect(mockPrisma.lead.update).toHaveBeenCalledWith({
        where: { id: mockLead.id },
        data: { propertyType: PropertyType.APARTMENT },
      });
      expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-123' },
        data: { onboardingStep: OnboardingStep.ASK_BUDGET },
      });
      expect(mockWhatsAppInteractiveService.sendListMessage).toHaveBeenCalledWith(
        mockLead.phone,
        expect.stringContaining('planned budget range'),
        'Select Budget',
        expect.any(Array),
        expect.objectContaining({ leadId: mockLead.id }),
      );

      // Step 2: ASK_BUDGET
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-123',
        leadId: mockLead.id,
        lead: { ...mockLead, propertyType: PropertyType.APARTMENT },
        onboardingStep: OnboardingStep.ASK_BUDGET,
      });

      const step2Result = await service.handleReply('conv-123', {
        listId: 'band_1',
      });

      expect(step2Result.handled).toBe(true);
      expect(step2Result.advancedTo).toBe(OnboardingStep.ASK_LOCATION);
      expect(mockPrisma.lead.update).toHaveBeenCalledWith({
        where: { id: mockLead.id },
        data: { budgetMin: 5000000, budgetMax: 10000000 },
      });
      expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-123' },
        data: { onboardingStep: OnboardingStep.ASK_LOCATION },
      });
      expect(mockWhatsAppInteractiveService.sendTextMessage).toHaveBeenCalledWith(
        mockLead.phone,
        expect.stringContaining('Which location or neighborhood'),
        expect.objectContaining({ leadId: mockLead.id }),
      );

      // Step 3: ASK_LOCATION
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-123',
        leadId: mockLead.id,
        lead: {
          ...mockLead,
          propertyType: PropertyType.APARTMENT,
          budgetMin: 5000000,
          budgetMax: 10000000,
        },
        onboardingStep: OnboardingStep.ASK_LOCATION,
      });

      const step3Result = await service.handleReply('conv-123', 'Whitefield, Bengaluru');

      expect(step3Result.handled).toBe(true);
      expect(step3Result.advancedTo).toBe(OnboardingStep.ASK_TIMELINE);
      expect(mockPrisma.lead.update).toHaveBeenCalledWith({
        where: { id: mockLead.id },
        data: { preferredLocations: ['Whitefield, Bengaluru'] },
      });
      expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-123' },
        data: { onboardingStep: OnboardingStep.ASK_TIMELINE },
      });
      expect(mockWhatsAppInteractiveService.sendButtonMessage).toHaveBeenCalledWith(
        mockLead.phone,
        expect.stringContaining('When are you planning to buy'),
        TIMELINE_BUTTONS,
        expect.objectContaining({ leadId: mockLead.id }),
      );

      // Step 4: ASK_TIMELINE
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-123',
        leadId: mockLead.id,
        lead: {
          ...mockLead,
          propertyType: PropertyType.APARTMENT,
          budgetMin: 5000000,
          budgetMax: 10000000,
          preferredLocations: ['Whitefield, Bengaluru'],
        },
        onboardingStep: OnboardingStep.ASK_TIMELINE,
      });

      const step4Result = await service.handleReply('conv-123', {
        buttonId: 'timeline_immediate',
      });

      expect(step4Result.handled).toBe(true);
      expect(step4Result.status).toBe(LeadQualificationStatus.QUALIFIED);
      expect(step4Result.onboardingStep).toBe(OnboardingStep.COMPLETE);

      // Verify Lead qualification updates
      expect(mockPrisma.lead.update).toHaveBeenCalledWith({
        where: { id: mockLead.id },
        data: {
          urgency: LeadUrgency.IMMEDIATE,
          qualificationStatus: LeadQualificationStatus.QUALIFIED,
          stage: LeadStage.REQUIREMENT_GATHERED,
        },
      });

      // Verify Conversation marked complete
      expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-123' },
        data: { onboardingStep: OnboardingStep.COMPLETE },
      });

      // Verify completion message sent
      expect(mockWhatsAppInteractiveService.sendTextMessage).toHaveBeenCalledWith(
        mockLead.phone,
        expect.stringContaining('Thank you! Your preferences have been saved'),
        expect.objectContaining({ leadId: mockLead.id }),
      );

      // Verify Matching Engine triggered
      expect(mockMatchesService.generateMatchesForLead).toHaveBeenCalledWith(mockLead.id);
    });
  });

  describe('Agent Keyword Interruption', () => {
    const steps = [
      OnboardingStep.ASK_PROPERTY_TYPE,
      OnboardingStep.ASK_BUDGET,
      OnboardingStep.ASK_LOCATION,
      OnboardingStep.ASK_TIMELINE,
    ];

    const agentKeywords = [
      'I want to talk to an agent please',
      'can i speak to a human?',
      'representative',
      'help, call me',
    ];

    steps.forEach((step, index) => {
      it(`should interrupt qualification at step "${step}" when keyword "${agentKeywords[index]}" is received`, async () => {
        mockPrisma.conversation.findUnique.mockResolvedValue({
          id: 'conv-123',
          leadId: mockLead.id,
          lead: { ...mockLead, assignedAgentId: 'agent-99' },
          onboardingStep: step,
        });

        const result = await service.handleReply('conv-123', agentKeywords[index]);

        expect(result.handled).toBe(true);
        expect(result.status).toBe(LeadQualificationStatus.REQUESTED_AGENT);
        expect(result.onboardingStep).toBe(OnboardingStep.COMPLETE);

        // Verify lead updated to REQUESTED_AGENT
        expect(mockPrisma.lead.update).toHaveBeenCalledWith({
          where: { id: mockLead.id },
          data: { qualificationStatus: LeadQualificationStatus.REQUESTED_AGENT },
        });

        // Verify conversation updated to COMPLETE
        expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
          where: { id: 'conv-123' },
          data: { onboardingStep: OnboardingStep.COMPLETE },
        });

        // Verify notification created for assigned agent
        expect(mockPrisma.notification.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            userId: 'agent-99',
            type: NotificationType.SYSTEM,
            title: expect.stringContaining('Human Agent Requested'),
            metadata: expect.objectContaining({
              leadId: mockLead.id,
              reason: 'QUALIFICATION_INTERRUPTED_AGENT_REQUEST',
            }),
          }),
        });

        // Verify realtime websocket dispatch
        expect(mockNotificationsGateway.sendToUser).toHaveBeenCalledWith(
          'agent-99',
          'notification',
          expect.anything(),
        );

        // Verify user received acknowledgment
        expect(mockWhatsAppInteractiveService.sendTextMessage).toHaveBeenCalledWith(
          mockLead.phone,
          expect.stringContaining("We've paused the automated questions"),
          expect.objectContaining({ leadId: mockLead.id }),
        );

        // Verify Matching Engine was NOT triggered
        expect(mockMatchesService.generateMatchesForLead).not.toHaveBeenCalled();
      });
    });

    it('should notify all admins if lead has no assigned agent when agent request is triggered', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-123',
        leadId: mockLead.id,
        lead: { ...mockLead, assignedAgentId: null },
        onboardingStep: OnboardingStep.ASK_PROPERTY_TYPE,
      });

      mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);

      await service.handleReply('conv-123', 'human agent please');

      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(2);
      expect(mockNotificationsGateway.sendToUser).toHaveBeenCalledWith('admin-1', 'notification', expect.anything());
      expect(mockNotificationsGateway.sendToUser).toHaveBeenCalledWith('admin-2', 'notification', expect.anything());
    });
  });

  describe('Unrecognized Inputs & Re-prompts', () => {
    it('should re-prompt property type buttons if reply is not recognized at ASK_PROPERTY_TYPE', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-123',
        leadId: mockLead.id,
        lead: { ...mockLead },
        onboardingStep: OnboardingStep.ASK_PROPERTY_TYPE,
      });

      const result = await service.handleReply('conv-123', 'some random gibberish');

      expect(result.handled).toBe(true);
      expect(result.reprompted).toBe(true);
      expect(result.onboardingStep).toBe(OnboardingStep.ASK_PROPERTY_TYPE);

      // Verify re-prompt message sent
      expect(mockWhatsAppInteractiveService.sendButtonMessage).toHaveBeenCalledWith(
        mockLead.phone,
        expect.stringContaining('Please tap one of the options below'),
        PROPERTY_TYPE_BUTTONS,
        expect.objectContaining({ leadId: mockLead.id }),
      );

      // Verify DB was NOT advanced
      expect(mockPrisma.conversation.update).not.toHaveBeenCalled();
    });

    it('should re-prompt budget list if selection is not recognized at ASK_BUDGET', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-123',
        leadId: mockLead.id,
        lead: { ...mockLead },
        onboardingStep: OnboardingStep.ASK_BUDGET,
      });

      const result = await service.handleReply('conv-123', {
        listId: 'invalid_band_999',
      });

      expect(result.handled).toBe(true);
      expect(result.reprompted).toBe(true);
      expect(result.onboardingStep).toBe(OnboardingStep.ASK_BUDGET);

      // Verify re-prompt list sent
      expect(mockWhatsAppInteractiveService.sendListMessage).toHaveBeenCalledWith(
        mockLead.phone,
        expect.stringContaining('Please select one of the budget options'),
        'Select Budget',
        expect.any(Array),
        expect.objectContaining({ leadId: mockLead.id }),
      );

      // Verify DB was NOT advanced
      expect(mockPrisma.conversation.update).not.toHaveBeenCalled();
    });

    it('should re-prompt timeline buttons if reply is not recognized at ASK_TIMELINE', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-123',
        leadId: mockLead.id,
        lead: { ...mockLead },
        onboardingStep: OnboardingStep.ASK_TIMELINE,
      });

      const result = await service.handleReply('conv-123', 'maybe sometime never');

      expect(result.handled).toBe(true);
      expect(result.reprompted).toBe(true);
      expect(result.onboardingStep).toBe(OnboardingStep.ASK_TIMELINE);

      // Verify re-prompt button message sent
      expect(mockWhatsAppInteractiveService.sendButtonMessage).toHaveBeenCalledWith(
        mockLead.phone,
        expect.stringContaining('Please tap one of the timeline options below'),
        TIMELINE_BUTTONS,
        expect.objectContaining({ leadId: mockLead.id }),
      );

      // Verify DB was NOT advanced
      expect(mockPrisma.conversation.update).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should return unhandled if conversation already in COMPLETE step', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-123',
        leadId: mockLead.id,
        lead: { ...mockLead },
        onboardingStep: OnboardingStep.COMPLETE,
      });

      const result = await service.handleReply('conv-123', 'Hello');

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('ALREADY_COMPLETED');
    });

    it('should return unhandled if conversation has no linked lead', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue({
        id: 'conv-123',
        leadId: null,
        lead: null,
        onboardingStep: OnboardingStep.ASK_PROPERTY_TYPE,
      });

      const result = await service.handleReply('conv-123', 'prop_type_apartment');

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('NO_LINKED_LEAD');
    });
  });
});
