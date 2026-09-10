import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InstagramMessagesHandler } from './instagram-messages.handler';
import { InstagramProfileService } from '../instagram-profile.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PhoneExtractionService } from '../../common/phone/phone-extraction.service';
import { MergeLeadsService } from '../../leads/merge-leads.service';
import { WhatsAppTemplateService } from '../../whatsapp/whatsapp-template.service';
import { LeadStage, ChannelType, LeadSource, LeadQualificationStatus } from '@prisma/client';

import { MatchesService } from '../../matches/matches.service';

import { LeadQualificationService } from '../../leads/lead-qualification.service';

describe('InstagramMessagesHandler', () => {
  let handler: InstagramMessagesHandler;
  let prisma: PrismaService;
  let phoneService: PhoneExtractionService;
  let mergeLeadsService: MergeLeadsService;
  let whatsAppTemplateService: WhatsAppTemplateService;
  let matchesService: MatchesService;
  let instagramProfileService: InstagramProfileService;
  let leadQualificationService: LeadQualificationService;

  const mockPrisma: any = {
    message: {
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({ id: 'msg-uuid-1', ...args.data }),
      ),
    },
    lead: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({ id: 'lead-uuid-1', ...args.data }),
      ),
      update: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({ id: args.where.id, ...args.data }),
      ),
    },
    conversation: {
      upsert: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({ id: 'conv-uuid-1', ...args.create }),
      ),
    },
    pendingInterest: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 'admin-1', role: 'ADMIN' }),
    },
    notification: {
      create: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({ id: 'notif-1', ...args.data }),
      ),
    },
    interaction: {
      create: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({ id: 'inter-1', ...args.data }),
      ),
    },
  };

  const mockPhoneService = {
    extractPhoneNumber: jest.fn(),
  };

  const mockMergeLeadsService = {
    mergeLeadByPhone: jest.fn().mockImplementation((leadId: string, phone: string) => {
      return Promise.resolve({
        primaryLead: { id: leadId, phone },
        merged: false,
      });
    }),
  };

  const mockWhatsAppTemplateService = {
    sendPropertyDetailsTemplate: jest.fn().mockResolvedValue({ success: true }),
  };

  const mockMatchesService = {
    createExplicitMatch: jest.fn().mockResolvedValue({ id: 'match-explicit-1', score: 100, isExplicit: true }),
    generateMatchesForLead: jest.fn().mockResolvedValue([]),
  };

  const mockInstagramProfileService = {
    getProfile: jest.fn().mockResolvedValue(null),
  };

  const mockLeadQualificationService = {
    startQualification: jest.fn().mockResolvedValue({ success: true, onboardingStep: 'ASK_PROPERTY_TYPE' }),
    handleReply: jest.fn().mockResolvedValue({ handled: true }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(global, 'fetch').mockImplementation(
      () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as any),
    );

    mockPrisma.lead.update.mockImplementation((args: any) =>
      Promise.resolve({ id: args.where.id, ...args.data }),
    );
    mockWhatsAppTemplateService.sendPropertyDetailsTemplate.mockResolvedValue({ success: true });
    mockInstagramProfileService.getProfile.mockResolvedValue(null);
    mockLeadQualificationService.startQualification.mockResolvedValue({ success: true, onboardingStep: 'ASK_PROPERTY_TYPE' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstagramMessagesHandler,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('mock_token') } },
        { provide: InstagramProfileService, useValue: mockInstagramProfileService },
        { provide: PhoneExtractionService, useValue: mockPhoneService },
        { provide: MergeLeadsService, useValue: mockMergeLeadsService },
        { provide: WhatsAppTemplateService, useValue: mockWhatsAppTemplateService },
        { provide: MatchesService, useValue: mockMatchesService },
        { provide: LeadQualificationService, useValue: mockLeadQualificationService },
      ],
    }).compile();

    handler = module.get<InstagramMessagesHandler>(InstagramMessagesHandler);
    prisma = module.get<PrismaService>(PrismaService);
    phoneService = module.get<PhoneExtractionService>(PhoneExtractionService);
    mergeLeadsService = module.get<MergeLeadsService>(MergeLeadsService);
    whatsAppTemplateService = module.get<WhatsAppTemplateService>(WhatsAppTemplateService);
    matchesService = module.get<MatchesService>(MatchesService);
    instagramProfileService = module.get<InstagramProfileService>(InstagramProfileService);
    leadQualificationService = module.get<LeadQualificationService>(LeadQualificationService);
  });

  it('should skip duplicate messages by externalMessageId', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'existing-msg-1' });

    const result = await handler.handleInboundDm({
      sender: { id: 'ig_user_123' },
      message: { mid: 'mid.duplicate123', text: 'Hello' },
    });

    expect(result).toBeNull();
    expect(mockPrisma.lead.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.message.create).not.toHaveBeenCalled();
  });

  it('should create new Unqualified lead with real name when profile API succeeds', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null);
    mockPrisma.lead.findUnique.mockResolvedValue(null);
    mockPhoneService.extractPhoneNumber.mockReturnValue({ found: false, confidence: 'NONE' });
    mockInstagramProfileService.getProfile.mockResolvedValue({
      name: 'Aditya Verma',
      username: 'aditya_v',
      profilePic: 'https://fbcdn.net/pic.jpg',
    });

    const result = await handler.handleInboundDm({
      sender: { id: 'ig_user_456' },
      message: { mid: 'mid.new_msg_456', text: 'Hey, I want to know more about the 2BHK.' },
    });

    expect(mockInstagramProfileService.getProfile).toHaveBeenCalledWith('ig_user_456');
    expect(mockPrisma.lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Aditya Verma (@aditya_v)',
        instagramUserId: 'ig_user_456',
        stage: LeadStage.UNQUALIFIED,
        qualificationStatus: LeadQualificationStatus.UNQUALIFIED,
        source: LeadSource.INSTAGRAM,
        sources: ['Instagram'],
      }),
    });

    expect(result).toEqual(
      expect.objectContaining({
        phoneExtracted: false,
        whatsappDeliveryEligible: false,
      }),
    );
  });

  it('should fallback to username when profile name is unavailable', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null);
    mockPrisma.lead.findUnique.mockResolvedValue(null);
    mockPhoneService.extractPhoneNumber.mockReturnValue({ found: false, confidence: 'NONE' });
    mockInstagramProfileService.getProfile.mockResolvedValue({
      name: null,
      username: 'priya_realty',
      profilePic: null,
    });

    await handler.handleInboundDm({
      sender: { id: 'ig_user_username_only' },
      message: { mid: 'mid.username_msg', text: 'Is this available?' },
    });

    expect(mockPrisma.lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '@priya_realty',
        instagramUserId: 'ig_user_username_only',
      }),
    });
  });

  it('should set name to null rather than placeholder string when profile is unavailable', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null);
    mockPrisma.lead.findUnique.mockResolvedValue(null);
    mockPhoneService.extractPhoneNumber.mockReturnValue({ found: false, confidence: 'NONE' });
    mockInstagramProfileService.getProfile.mockResolvedValue(null);

    await handler.handleInboundDm({
      sender: { id: 'ig_user_no_profile' },
      message: { mid: 'mid.no_profile_msg', text: 'Details please' },
    });

    expect(mockPrisma.lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: null,
        instagramUserId: 'ig_user_no_profile',
      }),
    });
  });

  it('should extract phone number, set opt-in, upgrade stage to NEW, correlate PendingInterest, and mark WhatsApp delivery eligible', async () => {
    const rawMessageText = 'My WhatsApp number is 98765 43210, please send brochure';
    mockPrisma.message.findUnique.mockResolvedValue(null);
    mockPrisma.lead.findUnique.mockResolvedValue({
      id: 'existing-lead-1',
      instagramUserId: 'ig_user_789',
      stage: LeadStage.UNQUALIFIED,
      sources: ['Instagram'],
    });

    mockPhoneService.extractPhoneNumber.mockReturnValue({
      found: true,
      e164: '+919876543210',
      confidence: 'HIGH',
    });

    // Mock 1 unresolved pending interest from recent comment
    mockPrisma.pendingInterest.findMany.mockResolvedValue([
      {
        id: 'pending-1',
        propertyId: 'prop-villa-99',
        property: { id: 'prop-villa-99', title: 'Grand Palm Villa' },
        createdAt: new Date(),
      },
    ]);

    const result = await handler.handleInboundDm({
      sender: { id: 'ig_user_789' },
      message: { mid: 'mid.msg_phone_789', text: rawMessageText },
    });

    // 1. Check Lead updated to stage NEW, opt-in true, evidence set, property linked
    expect(mockPrisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'existing-lead-1' },
      data: expect.objectContaining({
        phone: '+919876543210',
        whatsappOptIn: true,
        whatsappOptInEvidence: rawMessageText,
        stage: LeadStage.NEW,
        interestedPropertyId: 'prop-villa-99',
      }),
    });

    // 2. Check PendingInterest resolved
    expect(mockPrisma.pendingInterest.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['pending-1'] } },
      data: { resolved: true },
    });

    // 3. Check WhatsApp delivery eligibility and automatic trigger execution
    expect(result).toEqual(
      expect.objectContaining({
        phoneExtracted: true,
        phone: '+919876543210',
        interestedPropertyId: 'prop-villa-99',
        whatsappDeliveryEligible: true,
        whatsappDelivered: true,
        manualFollowUpFlagged: false,
      }),
    );

    expect(mockWhatsAppTemplateService.sendPropertyDetailsTemplate).toHaveBeenCalledWith(
      'existing-lead-1',
    );
  });

  it('should automatically flag lead for manual follow-up if template send fails (Stage P2-10)', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null);
    mockPrisma.lead.findUnique.mockResolvedValue({
      id: 'lead-fail-1',
      name: 'Rohan Sharma',
      instagramUserId: 'ig_user_fail',
      stage: LeadStage.UNQUALIFIED,
      sources: ['Instagram'],
      assignedAgentId: 'agent-123',
    });

    mockPrisma.lead.update.mockResolvedValue({
      id: 'lead-fail-1',
      name: 'Rohan Sharma',
      phone: '+919876543210',
      whatsappOptIn: true,
      interestedPropertyId: 'prop-villa-99',
      stage: LeadStage.NEW,
      assignedAgentId: 'agent-123',
    });

    mockPhoneService.extractPhoneNumber.mockReturnValue({
      found: true,
      e164: '+919876543210',
      confidence: 'HIGH',
    });

    mockPrisma.pendingInterest.findMany.mockResolvedValue([
      {
        id: 'pending-1',
        propertyId: 'prop-villa-99',
        property: { id: 'prop-villa-99', title: 'Grand Palm Villa' },
        createdAt: new Date(),
      },
    ]);

    // Simulate Meta API / template send failure
    mockWhatsAppTemplateService.sendPropertyDetailsTemplate.mockRejectedValue(
      new Error('Meta Cloud API Token expired (Error 190)'),
    );

    const result = await handler.handleInboundDm({
      sender: { id: 'ig_user_fail' },
      message: { mid: 'mid.fail_test', text: 'My number is 9876543210' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        phoneExtracted: true,
        whatsappDeliveryEligible: true,
        whatsappDelivered: false,
        manualFollowUpFlagged: true,
        whatsappDeliveryError: expect.stringContaining('Meta Cloud API Token expired'),
      }),
    );

    // Verify Notification and Interaction created for assigned agent
    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'agent-123',
        title: 'Action Needed: WhatsApp Brochure Failed',
        message: expect.stringContaining('Rohan Sharma'),
      }),
    });

    expect(mockPrisma.interaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId: 'lead-fail-1',
        agentId: 'agent-123',
        notes: expect.stringContaining('Meta Cloud API Token expired'),
      }),
    });
  });

  it('should handle multiple unresolved PendingInterests by selecting the most recent without guessing', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null);
    mockPrisma.lead.findUnique.mockResolvedValue({
      id: 'lead-multi-1',
      instagramUserId: 'ig_user_multi',
      stage: LeadStage.UNQUALIFIED,
      sources: [],
    });

    mockPhoneService.extractPhoneNumber.mockReturnValue({
      found: true,
      e164: '+919876543210',
      confidence: 'HIGH',
    });

    // Mock 2 unresolved pending interests within 48h
    mockPrisma.pendingInterest.findMany.mockResolvedValue([
      {
        id: 'pending-recent',
        propertyId: 'prop-recent-1',
        property: { id: 'prop-recent-1', title: 'Modern 3BHK Apartment' },
        createdAt: new Date(),
      },
      {
        id: 'pending-older',
        propertyId: 'prop-older-2',
        property: { id: 'prop-older-2', title: 'Luxury Villa' },
        createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
      },
    ]);

    const result = await handler.handleInboundDm({
      sender: { id: 'ig_user_multi' },
      message: { mid: 'mid.multi_test', text: 'Call 9876543210' },
    });

    // Should correlate to most recent property
    expect(result?.interestedPropertyId).toBe('prop-recent-1');
    expect(mockPrisma.pendingInterest.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['pending-recent', 'pending-older'] } },
      data: { resolved: true },
    });
  });

  it('should not be eligible for WhatsApp delivery if interestedPropertyId is missing', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null);
    mockPrisma.lead.findUnique.mockResolvedValue({
      id: 'lead-no-prop',
      instagramUserId: 'ig_user_noprop',
      stage: LeadStage.UNQUALIFIED,
      sources: ['Instagram'],
    });

    mockPhoneService.extractPhoneNumber.mockReturnValue({
      found: true,
      e164: '+919876543210',
      confidence: 'HIGH',
    });

    // No pending comments
    mockPrisma.pendingInterest.findMany.mockResolvedValue([]);

    const result = await handler.handleInboundDm({
      sender: { id: 'ig_user_noprop' },
      message: { mid: 'mid.noprop', text: 'Here is my phone 9876543210' },
    });

    // Phone extracted & stage NEW, but whatsappDeliveryEligible is false because interestedPropertyId is not known
    expect(result?.phoneExtracted).toBe(true);
    expect(result?.whatsappDeliveryEligible).toBe(false);
    expect(result?.whatsappDelivered).toBe(false);
    expect(mockWhatsAppTemplateService.sendPropertyDetailsTemplate).not.toHaveBeenCalled();
    // But qualification bot is triggered because phone & whatsappOptIn exist!
    expect(mockLeadQualificationService.startQualification).toHaveBeenCalledWith('lead-no-prop');
    expect(result?.qualificationStarted).toBe(true);
  });

  it('should automatically trigger startQualification when phone is captured and lead is UNQUALIFIED', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null);
    mockPrisma.lead.findUnique.mockResolvedValue({
      id: 'lead-ig-qual-1',
      instagramUserId: 'ig_user_qual',
      stage: LeadStage.UNQUALIFIED,
      qualificationStatus: LeadQualificationStatus.UNQUALIFIED,
      sources: ['Instagram'],
    });

    mockPhoneService.extractPhoneNumber.mockReturnValue({
      found: true,
      e164: '+919876543210',
      confidence: 'HIGH',
    });

    mockPrisma.pendingInterest.findMany.mockResolvedValue([]);

    const result = await handler.handleInboundDm({
      sender: { id: 'ig_user_qual' },
      message: { mid: 'mid.qual_1', text: 'My number is +91 9876543210' },
    });

    expect(result?.qualificationStarted).toBe(true);
    expect(mockLeadQualificationService.startQualification).toHaveBeenCalledWith('lead-ig-qual-1');
  });

  it('should not double-trigger qualification if lead is already IN_PROGRESS or QUALIFIED', async () => {
    mockPrisma.message.findUnique.mockResolvedValue(null);
    mockPrisma.lead.findUnique.mockResolvedValue({
      id: 'lead-ig-already-in-prog',
      instagramUserId: 'ig_user_in_prog',
      stage: LeadStage.NEW,
      qualificationStatus: LeadQualificationStatus.IN_PROGRESS,
      sources: ['Instagram'],
    });

    mockPhoneService.extractPhoneNumber.mockReturnValue({
      found: true,
      e164: '+919876543210',
      confidence: 'HIGH',
    });

    mockPrisma.pendingInterest.findMany.mockResolvedValue([]);

    const result = await handler.handleInboundDm({
      sender: { id: 'ig_user_in_prog' },
      message: { mid: 'mid.in_prog_2', text: 'Here again: 9876543210' },
    });

    expect(result?.qualificationStarted).toBe(false);
    expect(mockLeadQualificationService.startQualification).not.toHaveBeenCalled();
  });
});
