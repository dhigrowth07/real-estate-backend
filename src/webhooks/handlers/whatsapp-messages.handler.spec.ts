import { Test, TestingModule } from '@nestjs/testing';
import { WhatsAppMessagesHandler } from './whatsapp-messages.handler';
import { PrismaService } from '../../prisma/prisma.service';
import { PhoneExtractionService } from '../../common/phone/phone-extraction.service';
import { MatchesService } from '../../matches/matches.service';
import { LeadQualificationService } from '../../leads/lead-qualification.service';
import {
  LeadStage,
  LeadSource,
  LeadQualificationStatus,
  OnboardingStep,
  ChannelType,
  MessageDirection,
} from '@prisma/client';

describe('WhatsAppMessagesHandler', () => {
  let handler: WhatsAppMessagesHandler;
  let prisma: PrismaService;
  let phoneService: PhoneExtractionService;
  let matchesService: MatchesService;
  let leadQualificationService: LeadQualificationService;

  const mockPrisma = {
    message: {
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation((args) =>
        Promise.resolve({ id: 'msg-wa-1', ...args.data }),
      ),
    },
    lead: {
      findFirst: jest.fn(),
      create: jest.fn().mockImplementation((args) =>
        Promise.resolve({ id: 'lead-wa-1', qualificationStatus: LeadQualificationStatus.UNQUALIFIED, ...args.data }),
      ),
      update: jest.fn().mockImplementation((args) =>
        Promise.resolve({ id: args.where.id, ...args.data }),
      ),
    },
    conversation: {
      upsert: jest.fn().mockImplementation((args) =>
        Promise.resolve({ id: 'conv-wa-1', onboardingStep: OnboardingStep.NOT_STARTED, ...args.create }),
      ),
    },
  };

  const mockPhoneService = {
    extractPhoneNumber: jest.fn((num: string) => {
      if (num.includes('9876543210')) {
        return { found: true, e164: '+919876543210' };
      }
      return { found: false };
    }),
  };

  const mockMatchesService = {
    generateMatchesForLead: jest.fn().mockResolvedValue([]),
  };

  const mockLeadQualificationService = {
    startQualification: jest.fn().mockResolvedValue({ success: true, onboardingStep: OnboardingStep.ASK_PROPERTY_TYPE }),
    handleReply: jest.fn().mockResolvedValue({ handled: true }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockLeadQualificationService.startQualification.mockResolvedValue({ success: true, onboardingStep: OnboardingStep.ASK_PROPERTY_TYPE });
    mockLeadQualificationService.handleReply.mockResolvedValue({ handled: true });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppMessagesHandler,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PhoneExtractionService, useValue: mockPhoneService },
        { provide: MatchesService, useValue: mockMatchesService },
        { provide: LeadQualificationService, useValue: mockLeadQualificationService },
      ],
    }).compile();

    handler = module.get<WhatsAppMessagesHandler>(WhatsAppMessagesHandler);
    prisma = module.get<PrismaService>(PrismaService);
    phoneService = module.get<PhoneExtractionService>(PhoneExtractionService);
    matchesService = module.get<MatchesService>(MatchesService);
    leadQualificationService = module.get<LeadQualificationService>(LeadQualificationService);
  });

  it('should skip duplicate WhatsApp messages by external message ID', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'existing-wa-msg' });

    const result = await handler.handleInboundMessage({
      id: 'wamid.HBgLMDExMjM0NTY=',
      from: '919876543210',
      text: { body: 'Hello' },
    });

    expect(result).toBeNull();
    expect(mockPrisma.lead.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });

  it('should create new Lead with stage NEW, opt-in true, Conversation with 24h window, trigger Matching Engine, and trigger Qualification Bot', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null);
    mockPrisma.lead.findFirst.mockResolvedValue(null);

    const result = await handler.handleInboundMessage(
      {
        id: 'wamid.HBgLMDExMjM0NTY=',
        from: '919876543210',
        text: { body: 'Hi, looking for 3 BHK apartments in Whitefield.' },
      },
      [{ profile: { name: 'Sarah Jenkins' }, wa_id: '919876543210' }],
    );

    // 1. Check Lead created with correct attributes
    expect(mockPrisma.lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Sarah Jenkins',
        phone: '+919876543210',
        source: LeadSource.WHATSAPP,
        sources: ['WhatsApp'],
        stage: LeadStage.NEW,
        qualificationStatus: LeadQualificationStatus.UNQUALIFIED,
        whatsappOptIn: true,
        whatsappOptInEvidence: 'Hi, looking for 3 BHK apartments in Whitefield.',
      }),
    });

    // 2. Check Conversation created with 24h window
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
        leadId: 'lead-wa-1',
      }),
      update: expect.objectContaining({
        leadId: 'lead-wa-1',
      }),
    });

    // 3. Check Message recorded
    expect(mockPrisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'conv-wa-1',
        direction: MessageDirection.INBOUND,
        rawText: 'Hi, looking for 3 BHK apartments in Whitefield.',
        externalMessageId: 'wamid.HBgLMDExMjM0NTY=',
      }),
    });

    // 4. Check Qualification Bot triggered for new direct WhatsApp contact
    expect(mockLeadQualificationService.startQualification).toHaveBeenCalledWith('lead-wa-1');
    expect(result?.qualificationStarted).toBe(true);

    // 5. Check Matching Engine triggered for new lead
    expect(mockMatchesService.generateMatchesForLead).toHaveBeenCalledWith('lead-wa-1');

    expect(result).toEqual(
      expect.objectContaining({
        isNewLead: true,
        phone: '+919876543210',
      }),
    );
  });

  it('should update existing Lead with WhatsApp source and opt-in without re-running matching engine unnecessarily', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null);
    mockPrisma.lead.findFirst.mockResolvedValue({
      id: 'existing-lead-44',
      name: 'Sarah Jenkins',
      phone: '+919876543210',
      source: LeadSource.WEBSITE,
      sources: ['Website'],
      whatsappOptIn: false,
      qualificationStatus: LeadQualificationStatus.QUALIFIED,
    });
    mockPrisma.conversation.upsert.mockResolvedValue({
      id: 'conv-wa-1',
      onboardingStep: OnboardingStep.COMPLETE,
    });

    const result = await handler.handleInboundMessage({
      id: 'wamid.HBgLNEWMSG001',
      from: '919876543210',
      text: { body: 'Yes, please contact me on WhatsApp.' },
    });

    expect(mockPrisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'existing-lead-44' },
      data: expect.objectContaining({
        sources: ['Website', 'WhatsApp'],
        whatsappOptIn: true,
        whatsappOptInEvidence: 'Yes, please contact me on WhatsApp.',
      }),
    });

    expect(mockMatchesService.generateMatchesForLead).not.toHaveBeenCalled();
    expect(mockLeadQualificationService.startQualification).not.toHaveBeenCalled();
    expect(result?.isNewLead).toBe(false);
  });

  it('should dispatch interactive reply to LeadQualificationService if onboardingStep is in progress', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null);
    mockPrisma.lead.findFirst.mockResolvedValue({
      id: 'existing-lead-44',
      phone: '+919876543210',
      sources: ['WhatsApp'],
      whatsappOptIn: true,
      qualificationStatus: LeadQualificationStatus.IN_PROGRESS,
    });

    mockPrisma.conversation.upsert.mockResolvedValue({
      id: 'conv-wa-in-progress',
      onboardingStep: OnboardingStep.ASK_PROPERTY_TYPE,
      leadId: 'existing-lead-44',
    });

    // Interactive button reply
    const result = await handler.handleInboundMessage({
      id: 'wamid.BTN001',
      from: '919876543210',
      interactive: {
        type: 'button_reply',
        button_reply: { id: 'prop_type_apartment', title: 'Apartment' },
      },
    });

    expect(mockLeadQualificationService.handleReply).toHaveBeenCalledWith(
      'conv-wa-in-progress',
      expect.objectContaining({
        buttonId: 'prop_type_apartment',
        text: 'Apartment',
      }),
    );
    expect(result?.qualificationHandled).toBe(true);
  });
});
