import { Test, TestingModule } from '@nestjs/testing';
import { MergeLeadsService } from './merge-leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { MatchesService } from '../matches/matches.service';
import { LeadStage, LeadSource, PropertyType, LeadPurpose, LeadUrgency } from '@prisma/client';

describe('MergeLeadsService', () => {
  let service: MergeLeadsService;
  let prisma: PrismaService;
  let matchesService: MatchesService;

  const mockPrisma = {
    lead: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    interaction: {
      updateMany: jest.fn(),
    },
    conversation: {
      updateMany: jest.fn(),
    },
    match: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation(async (callback) => {
      return callback(mockPrisma);
    }),
  };

  const mockMatchesService = {
    generateMatchesForLead: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MergeLeadsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MatchesService, useValue: mockMatchesService },
      ],
    }).compile();

    service = module.get<MergeLeadsService>(MergeLeadsService);
    prisma = module.get<PrismaService>(PrismaService);
    matchesService = module.get<MatchesService>(MatchesService);
  });

  it('should return non-merged result if no duplicate lead with same phone exists', async () => {
    const singleLead = {
      id: 'lead-100',
      name: 'John Doe',
      phone: '+919876543210',
      source: LeadSource.WEBSITE,
      sources: ['Website'],
      createdAt: new Date(),
    };

    mockPrisma.lead.findUnique.mockResolvedValue(singleLead);
    mockPrisma.lead.findMany.mockResolvedValue([]);

    const result = await service.mergeLeadByPhone('lead-100', '+919876543210');

    expect(result.merged).toBe(false);
    expect(result.primaryLead.id).toBe('lead-100');
    expect(mockPrisma.lead.update).not.toHaveBeenCalled();
    expect(mockPrisma.interaction.updateMany).not.toHaveBeenCalled();
  });

  it('should simulate: Lead created from Direct Call, later messaging via Instagram with same number -> Merges into one primary record with both sources and no data loss', async () => {
    // 1. Initial Lead created from phone call (older, full requirements)
    const existingCallLead = {
      id: 'lead-call-primary',
      name: 'Rajesh Kumar',
      phone: '+919876543210',
      email: 'rajesh@example.com',
      source: LeadSource.DIRECT_CALL,
      sources: ['Call'],
      budgetMin: 8000000,
      budgetMax: 12000000,
      preferredLocations: ['Indiranagar', 'Koramangala'],
      propertyType: PropertyType.APARTMENT,
      bhk: '3 BHK',
      purpose: LeadPurpose.BUY,
      urgency: LeadUrgency.IMMEDIATE,
      stage: LeadStage.CONTACTED,
      assignedAgentId: 'agent-1',
      interestedPropertyId: null,
      instagramUserId: null,
      whatsappOptIn: false,
      whatsappOptInEvidence: null,
      createdAt: new Date('2026-09-01T10:00:00Z'),
      updatedAt: new Date('2026-09-01T10:00:00Z'),
      deletedAt: null,
    };

    // 2. Incoming Lead created from Instagram DM (newer, unqualified initially, captures property interest + opt-in)
    const newInstagramLead = {
      id: 'lead-ig-duplicate',
      name: 'Instagram User (4321)',
      phone: '+919876543210',
      email: null,
      source: LeadSource.INSTAGRAM,
      sources: ['Instagram'],
      budgetMin: 0,
      budgetMax: 0,
      preferredLocations: [],
      propertyType: PropertyType.APARTMENT,
      bhk: null,
      purpose: LeadPurpose.BUY,
      urgency: LeadUrgency.IMMEDIATE,
      stage: LeadStage.NEW,
      assignedAgentId: null,
      interestedPropertyId: 'prop-villa-99',
      instagramUserId: 'ig_user_4321',
      whatsappOptIn: true,
      whatsappOptInEvidence: 'My phone is 9876543210 please send details',
      createdAt: new Date('2026-09-05T14:30:00Z'),
      updatedAt: new Date('2026-09-05T14:30:00Z'),
      deletedAt: null,
    };

    mockPrisma.lead.findUnique.mockResolvedValue(newInstagramLead);
    mockPrisma.lead.findMany.mockResolvedValue([existingCallLead]);

    mockPrisma.match.findMany.mockResolvedValue([]);
    mockPrisma.interaction.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.conversation.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.match.updateMany.mockResolvedValue({ count: 1 });

    mockPrisma.lead.update.mockImplementation((args) => {
      if (args.where.id === 'lead-ig-duplicate') {
        return Promise.resolve({ ...newInstagramLead, ...args.data });
      }
      return Promise.resolve({ ...existingCallLead, ...args.data });
    });

    const result = await service.mergeLeadByPhone('lead-ig-duplicate', '+919876543210');

    // Verify merge success
    expect(result.merged).toBe(true);
    expect(result.primaryLead.id).toBe('lead-call-primary');
    expect(result.duplicateLead?.id).toBe('lead-ig-duplicate');

    // Check that interactions and conversations were re-assigned to primary lead
    expect(mockPrisma.interaction.updateMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-ig-duplicate' },
      data: { leadId: 'lead-call-primary' },
    });

    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-ig-duplicate' },
      data: { leadId: 'lead-call-primary' },
    });

    // Check that duplicate lead was soft-deleted & instagramUserId cleared
    expect(mockPrisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-ig-duplicate' },
      data: expect.objectContaining({
        deletedAt: expect.any(Date),
        instagramUserId: null,
      }),
    });

    // Check that primary lead has merged sources ('Call', 'Instagram') and carried over Instagram fields
    expect(mockPrisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-call-primary' },
      data: expect.objectContaining({
        name: 'Rajesh Kumar',
        phone: '+919876543210',
        email: 'rajesh@example.com',
        sources: expect.arrayContaining(['Call', 'Instagram']),
        interestedPropertyId: 'prop-villa-99',
        instagramUserId: 'ig_user_4321',
        whatsappOptIn: true,
        whatsappOptInEvidence: 'My phone is 9876543210 please send details',
        budgetMin: 8000000,
        budgetMax: 12000000,
        stage: LeadStage.CONTACTED,
      }),
    });

    // Check Matching Engine was refreshed for primary lead
    expect(mockMatchesService.generateMatchesForLead).toHaveBeenCalledWith('lead-call-primary');
  });

  it('should handle conflict in matches by removing duplicate match property IDs prior to reassignment', async () => {
    const primaryLead = {
      id: 'lead-primary-1',
      name: 'Primary User',
      phone: '+919999999999',
      source: LeadSource.WEBSITE,
      sources: ['Website'],
      createdAt: new Date('2026-09-01'),
      deletedAt: null,
    };

    const duplicateLead = {
      id: 'lead-dup-2',
      name: 'Instagram User (9999)',
      phone: '+919999999999',
      source: LeadSource.INSTAGRAM,
      sources: ['Instagram'],
      createdAt: new Date('2026-09-02'),
      deletedAt: null,
    };

    mockPrisma.lead.findUnique.mockResolvedValue(duplicateLead);
    mockPrisma.lead.findMany.mockResolvedValue([primaryLead]);

    // Primary lead already has match for property 'prop-1'
    mockPrisma.match.findMany.mockResolvedValue([{ propertyId: 'prop-1' }]);

    mockPrisma.lead.update.mockResolvedValue({ ...primaryLead });

    await service.mergeLeadByPhone('lead-dup-2', '+919999999999');

    // Duplicate match for 'prop-1' on duplicate lead must be deleted to avoid unique constraint error
    expect(mockPrisma.match.deleteMany).toHaveBeenCalledWith({
      where: {
        leadId: 'lead-dup-2',
        propertyId: { in: ['prop-1'] },
      },
    });

    expect(mockPrisma.match.updateMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-dup-2' },
      data: { leadId: 'lead-primary-1' },
    });
  });
});
