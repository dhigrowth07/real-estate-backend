import { Test, TestingModule } from '@nestjs/testing';
import { InstagramCommentsHandler } from './instagram-comments.handler';
import { PrismaService } from '../../prisma/prisma.service';

describe('InstagramCommentsHandler', () => {
  let handler: InstagramCommentsHandler;
  let prisma: PrismaService;

  const mockPrisma = {
    pendingInterest: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    postPropertyMapping: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstagramCommentsHandler,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    handler = module.get<InstagramCommentsHandler>(InstagramCommentsHandler);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should skip duplicate comments by external comment ID', async () => {
    mockPrisma.pendingInterest.findUnique.mockResolvedValue({
      id: 'existing-pending-1',
      commentId: 'comment_12345',
      propertyId: 'prop-1',
    });

    const result = await handler.handleCommentEvent({
      id: 'comment_12345',
      text: 'Price please?',
      from: { id: 'ig_user_999' },
      media: { id: 'media_888' },
    });

    expect(result).toEqual(expect.objectContaining({ id: 'existing-pending-1' }));
    expect(mockPrisma.postPropertyMapping.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.pendingInterest.create).not.toHaveBeenCalled();
  });

  it('should log and skip if no PostPropertyMapping exists for the media ID', async () => {
    mockPrisma.pendingInterest.findUnique.mockResolvedValue(null);
    mockPrisma.postPropertyMapping.findFirst.mockResolvedValue(null);

    const result = await handler.handleCommentEvent({
      id: 'comment_new_001',
      text: 'Is this available for rent?',
      from: { id: 'ig_user_777', username: 'prospect_jane' },
      media: { id: 'unmapped_media_999' },
    });

    expect(result).toBeNull();
    expect(mockPrisma.postPropertyMapping.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { instagramMediaId: 'unmapped_media_999' },
        ]),
      }),
      include: expect.any(Object),
    });
    expect(mockPrisma.pendingInterest.create).not.toHaveBeenCalled();
  });

  it('should create PendingInterest record when mapping exists', async () => {
    mockPrisma.pendingInterest.findUnique.mockResolvedValue(null);
    mockPrisma.postPropertyMapping.findFirst.mockResolvedValue({
      id: 'mapping-uuid-1',
      instagramMediaId: 'media_reel_123',
      propertyId: 'prop-uuid-555',
      property: { id: 'prop-uuid-555', title: 'Grand Palm Villa' },
    });

    mockPrisma.pendingInterest.create.mockResolvedValue({
      id: 'pending-uuid-99',
      commentId: 'comment_reel_456',
      instagramUserId: 'ig_buyer_111',
      commenterUsername: 'luxury_buyer',
      propertyId: 'prop-uuid-555',
      commentText: 'How many BHK? Send brochure.',
      resolved: false,
    });

    const result = await handler.handleCommentEvent({
      id: 'comment_reel_456',
      text: 'How many BHK? Send brochure.',
      created_time: 1715000000,
      from: { id: 'ig_buyer_111', username: 'luxury_buyer' },
      media: { id: 'media_reel_123' },
    });

    expect(mockPrisma.pendingInterest.create).toHaveBeenCalledWith({
      data: {
        commentId: 'comment_reel_456',
        instagramUserId: 'ig_buyer_111',
        commenterUsername: 'luxury_buyer',
        propertyId: 'prop-uuid-555',
        commentText: 'How many BHK? Send brochure.',
        commentedAt: new Date(1715000000 * 1000),
        resolved: false,
      },
    });

    expect(result).toEqual(expect.objectContaining({
      id: 'pending-uuid-99',
      propertyId: 'prop-uuid-555',
      resolved: false,
    }));
  });

  it('should return null when commentId or commenterId is missing', async () => {
    const resNoId = await handler.handleCommentEvent({
      text: 'Hello',
      from: { id: 'user_1' },
    });
    expect(resNoId).toBeNull();

    const resNoUser = await handler.handleCommentEvent({
      id: 'comment_1',
      text: 'Hello',
    });
    expect(resNoUser).toBeNull();
  });
});
