import { Test, TestingModule } from '@nestjs/testing';
import { PostMappingsService } from './post-mappings.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('PostMappingsService', () => {
  let service: PostMappingsService;
  let prisma: PrismaService;

  const mockPrisma = {
    property: {
      findFirst: jest.fn(),
    },
    postPropertyMapping: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostMappingsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PostMappingsService>(PostMappingsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('extractMediaId', () => {
    it('should extract shortcode from Instagram Post URL', () => {
      const url = 'https://www.instagram.com/p/DFxyz123/';
      expect(service.extractMediaId(url)).toBe('DFxyz123');
    });

    it('should extract shortcode from Instagram Reel URL with query parameters', () => {
      const url = 'https://www.instagram.com/reel/C_reel890/?igsh=MWx123';
      expect(service.extractMediaId(url)).toBe('C_reel890');
    });

    it('should extract shortcode from Instagram TV URL', () => {
      const url = 'https://www.instagram.com/tv/B_tv456';
      expect(service.extractMediaId(url)).toBe('B_tv456');
    });

    it('should handle raw media ID or shortcode input directly', () => {
      expect(service.extractMediaId('1792348572019283')).toBe('1792348572019283');
      expect(service.extractMediaId('DFxyz123')).toBe('DFxyz123');
    });
  });

  describe('create', () => {
    it('should throw NotFoundException if property does not exist', async () => {
      mockPrisma.property.findFirst.mockResolvedValue(null);

      await expect(
        service.create({
          instagramMediaIdOrUrl: 'https://www.instagram.com/p/DFxyz123/',
          propertyId: 'non-existent-prop',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should upsert and return post mapping when property exists', async () => {
      mockPrisma.property.findFirst.mockResolvedValue({
        id: 'prop-uuid-1',
        title: 'Luxury 3 BHK Villa',
      });

      mockPrisma.postPropertyMapping.upsert.mockResolvedValue({
        id: 'map-uuid-1',
        instagramMediaId: 'DFxyz123',
        propertyId: 'prop-uuid-1',
        property: { id: 'prop-uuid-1', title: 'Luxury 3 BHK Villa' },
      });

      const result = await service.create({
        instagramMediaIdOrUrl: 'https://www.instagram.com/p/DFxyz123/',
        propertyId: 'prop-uuid-1',
      });

      expect(mockPrisma.property.findFirst).toHaveBeenCalledWith({
        where: { id: 'prop-uuid-1', deletedAt: null },
        select: expect.any(Object),
      });

      expect(mockPrisma.postPropertyMapping.upsert).toHaveBeenCalledWith({
        where: { instagramMediaId: 'DFxyz123' },
        create: { instagramMediaId: 'DFxyz123', propertyId: 'prop-uuid-1' },
        update: { propertyId: 'prop-uuid-1' },
        include: expect.any(Object),
      });

      expect(result.id).toBe('map-uuid-1');
      expect(result.instagramMediaId).toBe('DFxyz123');
    });
  });

  describe('remove', () => {
    it('should delete post mapping if found', async () => {
      mockPrisma.postPropertyMapping.findUnique.mockResolvedValue({
        id: 'map-1',
        instagramMediaId: 'DFxyz123',
      });
      mockPrisma.postPropertyMapping.delete.mockResolvedValue({ id: 'map-1' });

      const res = await service.remove('map-1');
      expect(res.success).toBe(true);
      expect(mockPrisma.postPropertyMapping.delete).toHaveBeenCalledWith({
        where: { id: 'map-1' },
      });
    });

    it('should throw NotFoundException if mapping does not exist', async () => {
      mockPrisma.postPropertyMapping.findUnique.mockResolvedValue(null);

      await expect(service.remove('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });
});
