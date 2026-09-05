import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostMappingDto } from './dto/create-post-mapping.dto';
import { PostMappingFilterDto } from './dto/post-mapping-filter.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class PostMappingsService {
  private readonly logger = new Logger(PostMappingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Extracts Instagram shortcode or raw media ID from URL or raw string
   * Handles:
   * - https://www.instagram.com/p/DFxyz123/
   * - https://www.instagram.com/reel/DFxyz123/?igsh=...
   * - https://www.instagram.com/tv/DFxyz123/
   * - Direct Meta media ID: 1792348572019283 or DFxyz123
   */
  extractMediaId(input: string): string {
    if (!input || typeof input !== 'string') {
      throw new BadRequestException('Invalid Instagram URL or media ID.');
    }

    const trimmed = input.trim();

    // Match shortcode in URL
    const match = trimmed.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i);
    if (match && match[1]) {
      return match[1];
    }

    // Clean any URL query parameters if pasted as partial URL
    const cleaned = trimmed.replace(/[?#].*$/, '').replace(/\/$/, '');
    const segments = cleaned.split('/');
    const lastSegment = segments[segments.length - 1];

    if (!lastSegment) {
      throw new BadRequestException('Could not parse Instagram Media ID or shortcode.');
    }

    return lastSegment;
  }

  /**
   * Create or update a PostPropertyMapping linking an Instagram post/reel to a property
   */
  async create(dto: CreatePostMappingDto) {
    const mediaId = this.extractMediaId(dto.instagramMediaIdOrUrl);

    // 1. Verify that the target property exists and is not soft-deleted
    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, deletedAt: null },
      select: {
        id: true,
        title: true,
        location: true,
        price: true,
        images: true,
        status: true,
      },
    });

    if (!property) {
      throw new NotFoundException(`Property with ID "${dto.propertyId}" does not exist.`);
    }

    // 2. Upsert mapping (if the Instagram media ID was previously linked, re-link to new property)
    const mapping = await this.prisma.postPropertyMapping.upsert({
      where: { instagramMediaId: mediaId },
      create: {
        instagramMediaId: mediaId,
        propertyId: dto.propertyId,
      },
      update: {
        propertyId: dto.propertyId,
      },
      include: {
        property: {
          select: {
            id: true,
            title: true,
            location: true,
            price: true,
            images: true,
            status: true,
          },
        },
      },
    });

    this.logger.log(
      `Linked Instagram Media ID "${mediaId}" to Property "${property.title}" (${property.id})`,
    );

    return mapping;
  }

  /**
   * List mappings with pagination, property relation, and search filtering
   */
  async findAll(filter?: PostMappingFilterDto) {
    const page = filter?.page || 1;
    const limit = filter?.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.PostPropertyMappingWhereInput = {};

    if (filter?.propertyId) {
      where.propertyId = filter.propertyId;
    }

    if (filter?.search) {
      where.OR = [
        { instagramMediaId: { contains: filter.search, mode: 'insensitive' } },
        { property: { title: { contains: filter.search, mode: 'insensitive' } } },
        { property: { location: { contains: filter.search, mode: 'insensitive' } } },
      ];
    }

    const [mappings, total] = await Promise.all([
      this.prisma.postPropertyMapping.findMany({
        where,
        include: {
          property: {
            select: {
              id: true,
              title: true,
              location: true,
              price: true,
              images: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.postPropertyMapping.count({ where }),
    ]);

    return {
      mappings,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get single mapping by ID
   */
  async findOne(id: string) {
    const mapping = await this.prisma.postPropertyMapping.findUnique({
      where: { id },
      include: {
        property: {
          select: {
            id: true,
            title: true,
            location: true,
            price: true,
            images: true,
            status: true,
          },
        },
      },
    });

    if (!mapping) {
      throw new NotFoundException(`Post-to-property mapping with ID "${id}" not found.`);
    }

    return mapping;
  }

  /**
   * Lookup mapping by Instagram Media ID (used by Webhooks comment processing)
   */
  async findByMediaId(instagramMediaId: string) {
    return this.prisma.postPropertyMapping.findUnique({
      where: { instagramMediaId },
      include: {
        property: true,
      },
    });
  }

  /**
   * Delete a post-to-property mapping
   */
  async remove(id: string) {
    const mapping = await this.prisma.postPropertyMapping.findUnique({
      where: { id },
    });

    if (!mapping) {
      throw new NotFoundException(`Post-to-property mapping with ID "${id}" not found.`);
    }

    await this.prisma.postPropertyMapping.delete({
      where: { id },
    });

    return {
      success: true,
      message: `Mapping for Instagram Media "${mapping.instagramMediaId}" deleted.`,
    };
  }
}
