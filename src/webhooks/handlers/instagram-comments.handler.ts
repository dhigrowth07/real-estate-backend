import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PendingInterest } from '@prisma/client';

export interface InstagramCommentWebhookValue {
  id?: string;
  text?: string;
  created_time?: number;
  timestamp?: string;
  from?: {
    id?: string;
    username?: string;
  };
  media?: {
    id?: string;
    media_product_type?: string;
  };
  media_id?: string;
  post_id?: string;
}

@Injectable()
export class InstagramCommentsHandler {
  private readonly logger = new Logger(InstagramCommentsHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Processes an incoming Instagram comment webhook change event
   * 1. Deduplicates by comment ID
   * 2. Resolves PostPropertyMapping for the media ID
   * 3. Creates a PendingInterest record for downstream DM correlation
   */
  async handleCommentEvent(
    value: InstagramCommentWebhookValue,
  ): Promise<PendingInterest | null> {
    const commentId = value?.id;
    const commenterId = value?.from?.id;
    const commenterUsername = value?.from?.username;
    const commentText = value?.text?.trim() || '';
    const mediaId = value?.media?.id || value?.media_id || value?.post_id;

    if (!commentId) {
      this.logger.warn('[Instagram Comment] Missing comment ID in payload. Skipping.');
      return null;
    }

    if (!commenterId) {
      this.logger.warn(`[Instagram Comment] Missing commenter user ID for comment ${commentId}. Skipping.`);
      return null;
    }

    // 1. Deduplicate by comment external ID
    const existing = await this.prisma.pendingInterest.findUnique({
      where: { commentId },
    });

    if (existing) {
      this.logger.log(
        `[Instagram Comment] Comment ${commentId} has already been processed (PendingInterest: ${existing.id}). Skipping duplicate.`,
      );
      return existing;
    }

    if (!mediaId) {
      this.logger.warn(
        `[Instagram Comment] Comment ${commentId} has no associated media ID. Skipping PendingInterest creation.`,
      );
      return null;
    }

    // 2. Look up PostPropertyMapping for the media ID
    const mapping = await this.prisma.postPropertyMapping.findFirst({
      where: {
        OR: [
          { instagramMediaId: mediaId },
          { instagramMediaId: { contains: mediaId, mode: 'insensitive' } },
        ],
      },
      include: {
        property: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (!mapping) {
      // Per workspace instructions: Log and skip if no mapping exists; do NOT guess
      this.logger.warn(
        `[Instagram Comment] No PostPropertyMapping found for Media ID "${mediaId}" (Comment: "${commentText}"). Skipping PendingInterest creation.`,
      );
      return null;
    }

    // 3. Create PendingInterest record
    let commentedAt = new Date();
    if (value.created_time) {
      commentedAt = new Date(value.created_time * 1000);
    } else if (value.timestamp) {
      commentedAt = new Date(value.timestamp);
    }

    const pendingInterest = await this.prisma.pendingInterest.create({
      data: {
        commentId,
        instagramUserId: commenterId,
        commenterUsername: commenterUsername || null,
        propertyId: mapping.propertyId,
        commentText,
        commentedAt,
        resolved: false,
      },
    });

    this.logger.log(
      `[Instagram Comment] Created PendingInterest "${pendingInterest.id}" for User "${commenterId}" (@${commenterUsername || 'unknown'}) on Property "${mapping.property?.title}" (${mapping.propertyId})`,
    );

    return pendingInterest;
  }
}
