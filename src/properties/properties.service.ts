import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyFilterDto } from './dto/property-filter.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class PropertiesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreatePropertyDto) {
    const property = await this.prisma.property.create({
      data: {
        title: dto.title,
        location: dto.location,
        price: dto.price,
        propertyType: dto.propertyType,
        bhk: dto.bhk,
        sqft: dto.sqft,
        possessionStatus: dto.possessionStatus || 'READY_TO_MOVE',
        amenities: dto.amenities || [],
        ownerContact: dto.ownerContact,
        images: dto.images || [],
        status: dto.status || 'AVAILABLE',
      },
    });

    return property;
  }

  async findAll(filter?: PropertyFilterDto) {
    const where: Prisma.PropertyWhereInput = {};

    if (filter?.propertyType) {
      where.propertyType = filter.propertyType;
    }
    if (filter?.status) {
      where.status = filter.status;
    }
    if (filter?.possessionStatus) {
      where.possessionStatus = filter.possessionStatus;
    }
    if (filter?.location) {
      where.location = { contains: filter.location, mode: 'insensitive' };
    }
    if (filter?.minPrice !== undefined || filter?.maxPrice !== undefined) {
      where.price = {};
      if (filter.minPrice !== undefined) where.price.gte = filter.minPrice;
      if (filter.maxPrice !== undefined) where.price.lte = filter.maxPrice;
    }
    if (filter?.search) {
      where.OR = [
        { title: { contains: filter.search, mode: 'insensitive' } },
        { location: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.property.findMany({
      where,
      include: {
        _count: {
          select: { matches: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: {
        matches: {
          include: {
            lead: true,
          },
          orderBy: { score: 'desc' },
        },
      },
    });

    if (!property) {
      throw new NotFoundException(`Property with ID ${id} not found`);
    }

    return property;
  }

  async update(id: string, dto: UpdatePropertyDto) {
    await this.findOne(id);

    return this.prisma.property.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.property.delete({
      where: { id },
    });
  }
}
