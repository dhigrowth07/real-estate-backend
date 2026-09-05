import { Test, TestingModule } from '@nestjs/testing';
import { MatchesService } from './matches.service';
import { MatchingEngineService } from './matching-engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PropertyType, LeadStage } from '@prisma/client';

describe('MatchesService', () => {
  let service: MatchesService;
  let prisma: PrismaService;
  let matchingEngine: MatchingEngineService;
  let notificationsService: NotificationsService;

  const mockPrisma = {
    match: {
      upsert: jest.fn().mockImplementation((args) =>
        Promise.resolve({ id: 'match-100', ...args.create }),
      ),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    lead: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    property: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    agencySetting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const mockMatchingEngine = {
    calculateScore: jest.fn().mockReturnValue({
      score: 75,
      breakdown: { budget: 35, location: 25, propertyType: 15, bhk: 0, possession: 0 },
    }),
  };

  const mockSettingsService = {
    getSettings: jest.fn().mockResolvedValue({ matchingWeights: null }),
  };

  const mockNotificationsService = {
    handleMatchAlert: jest.fn().mockResolvedValue(null),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MatchingEngineService, useValue: mockMatchingEngine },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<MatchesService>(MatchesService);
    prisma = module.get<PrismaService>(PrismaService);
    matchingEngine = module.get<MatchingEngineService>(MatchingEngineService);
    notificationsService = module.get<NotificationsService>(NotificationsService);
  });

  describe('createExplicitMatch', () => {
    it('should create an explicit match with score 100 and isExplicit true', async () => {
      const match = await service.createExplicitMatch('lead-1', 'prop-direct-100');

      expect(mockPrisma.match.upsert).toHaveBeenCalledWith({
        where: {
          leadId_propertyId: {
            leadId: 'lead-1',
            propertyId: 'prop-direct-100',
          },
        },
        create: expect.objectContaining({
          leadId: 'lead-1',
          propertyId: 'prop-direct-100',
          score: 100,
          isExplicit: true,
          breakdown: expect.objectContaining({
            isExplicit: true,
            explicitReason: 'Direct inquiry on property listing',
          }),
        }),
        update: expect.objectContaining({
          score: 100,
          isExplicit: true,
        }),
      });

      expect(mockNotificationsService.handleMatchAlert).toHaveBeenCalledWith('match-100');
      expect(match.score).toBe(100);
      expect(match.isExplicit).toBe(true);
    });
  });

  describe('generateMatchesForLead (Additive Scoring)', () => {
    it('should assign score 100 and isExplicit true to interestedPropertyId, while normally scoring all other properties', async () => {
      const lead = {
        id: 'lead-interested',
        name: 'Anita Roy',
        interestedPropertyId: 'prop-explicit-1',
        budgetMin: 5000000,
        budgetMax: 9000000,
        preferredLocations: ['Whitefield'],
        propertyType: PropertyType.APARTMENT,
      };

      const properties = [
        { id: 'prop-explicit-1', title: 'Direct Interest Luxury Flat' },
        { id: 'prop-other-2', title: 'Other Matched Villa' },
      ];

      mockPrisma.lead.findFirst.mockResolvedValue(lead);
      mockPrisma.property.findMany.mockResolvedValue(properties);

      mockMatchingEngine.calculateScore.mockReturnValue({
        score: 65,
        breakdown: { budget: 20, location: 25, propertyType: 20 },
      });

      const results = await service.generateMatchesForLead('lead-interested');

      expect(results).toHaveLength(2);

      // Check first property (interestedPropertyId): score must be 100 and isExplicit true
      expect(mockPrisma.match.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            leadId_propertyId: {
              leadId: 'lead-interested',
              propertyId: 'prop-explicit-1',
            },
          },
          create: expect.objectContaining({
            score: 100,
            isExplicit: true,
          }),
        }),
      );

      // Check second property (regular catalog property): score is standard 65 and isExplicit false
      expect(mockPrisma.match.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            leadId_propertyId: {
              leadId: 'lead-interested',
              propertyId: 'prop-other-2',
            },
          },
          create: expect.objectContaining({
            score: 65,
            isExplicit: false,
          }),
        }),
      );
    });
  });
});
