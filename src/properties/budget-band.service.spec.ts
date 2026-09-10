import { Test, TestingModule } from '@nestjs/testing';
import { BudgetBandService, FALLBACK_BUDGET_BANDS } from './budget-band.service';
import { PrismaService } from '../prisma/prisma.service';
import { PropertyStatus, PropertyType } from '@prisma/client';

describe('BudgetBandService', () => {
  let service: BudgetBandService;
  let prisma: PrismaService;

  const mockPrisma = {
    property: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetBandService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BudgetBandService>(BudgetBandService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('generateBudgetBands', () => {
    it('should return fallback budget bands when no active properties are found', async () => {
      mockPrisma.property.findMany.mockResolvedValue([]);

      const bands = await service.generateBudgetBands();

      expect(bands).toEqual(FALLBACK_BUDGET_BANDS);
      expect(mockPrisma.property.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          status: PropertyStatus.AVAILABLE,
          deletedAt: null,
          price: { gt: 0 },
        }),
        select: { price: true },
        orderBy: { price: 'asc' },
      });
    });

    it('should return fallback budget bands when fewer than 4 properties are found', async () => {
      mockPrisma.property.findMany.mockResolvedValue([
        { price: 6000000 },
        { price: 12000000 },
      ]);

      const bands = await service.generateBudgetBands();
      expect(bands).toEqual(FALLBACK_BUDGET_BANDS);
    });

    it('should return fallback budget bands when prices are identical or too narrow', async () => {
      mockPrisma.property.findMany.mockResolvedValue([
        { price: 5000000 },
        { price: 5000000 },
        { price: 5000000 },
        { price: 5000000 },
      ]);

      const bands = await service.generateBudgetBands();
      expect(bands).toEqual(FALLBACK_BUDGET_BANDS);
    });

    it('should dynamically generate 4-5 sensible budget bands from real property prices', async () => {
      // 8 sample properties spanning ₹45 Lakhs to ₹3.5 Crores
      mockPrisma.property.findMany.mockResolvedValue([
        { price: 4500000 },  // 45L
        { price: 6500000 },  // 65L
        { price: 8500000 },  // 85L
        { price: 11000000 }, // 1.1 Cr
        { price: 14000000 }, // 1.4 Cr
        { price: 18000000 }, // 1.8 Cr
        { price: 25000000 }, // 2.5 Cr
        { price: 35000000 }, // 3.5 Cr
      ]);

      const bands = await service.generateBudgetBands();

      expect(bands.length).toBeGreaterThanOrEqual(4);
      expect(bands.length).toBeLessThanOrEqual(5);

      // Verify first band starts from 0 (entry-level)
      expect(bands[0].min).toBe(0);
      expect(bands[0].label).toContain('Under');

      // Verify last band extends to top tier
      const lastBand = bands[bands.length - 1];
      expect(lastBand.max).toBe(999999999);
      expect(lastBand.label).toContain('Above');

      // Verify all band labels adhere to Meta WhatsApp character limit (<= 24 chars)
      bands.forEach((b) => {
        expect(b.label.length).toBeLessThanOrEqual(24);
        expect(b.id).toBeDefined();
        expect(b.min).toBeLessThan(b.max);
      });

      // Verify bands are contiguous
      for (let i = 0; i < bands.length - 1; i++) {
        expect(bands[i].max).toBe(bands[i + 1].min);
      }
    });

    it('should filter by propertyType when provided', async () => {
      mockPrisma.property.findMany.mockResolvedValue([
        { price: 15000000 },
        { price: 25000000 },
        { price: 35000000 },
        { price: 50000000 },
      ]);

      await service.generateBudgetBands(PropertyType.VILLA);

      expect(mockPrisma.property.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          status: PropertyStatus.AVAILABLE,
          deletedAt: null,
          propertyType: PropertyType.VILLA,
        }),
        select: { price: true },
        orderBy: { price: 'asc' },
      });
    });
  });

  describe('formatPriceShort', () => {
    it('should format Indian currency figures cleanly', () => {
      expect(service.formatPriceShort(0)).toBe('₹0');
      expect(service.formatPriceShort(4500000)).toBe('₹45L');
      expect(service.formatPriceShort(7500000)).toBe('₹75L');
      expect(service.formatPriceShort(10000000)).toBe('₹1 Cr');
      expect(service.formatPriceShort(15000000)).toBe('₹1.5 Cr');
      expect(service.formatPriceShort(22500000)).toBe('₹2.25 Cr');
      expect(service.formatPriceShort(50000000)).toBe('₹5 Cr');
    });
  });
});
