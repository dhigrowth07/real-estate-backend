import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PendingInterest, PostPropertyMapping, Property } from '@prisma/client';

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

type MappingWithProperty = PostPropertyMapping & {
  property: {
    id: string;
    title: string;
  };
};

@Injectable()
export class InstagramCommentsHandler {
  private readonly logger = new Logger(InstagramCommentsHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Resolves a PostPropertyMapping for a given media ID.
   * 1. Direct DB lookup by numeric ID or shortcode
   * 2. Fallback: Query Meta Graph API to resolve numeric ID -> shortcode
   * 3. If resolved via shortcode, auto-caches the numeric ID mapping in DB
   */
  async resolveMappingForMedia(mediaId: string): Promise<MappingWithProperty | null> {
    // 1. Direct DB lookup
    const directMapping = await this.prisma.postPropertyMapping.findFirst({
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

    if (directMapping) {
      return directMapping as MappingWithProperty;
    }

    // 2. If mediaId is numeric (Meta Object ID), attempt Graph API lookup to get shortcode
    const token =
      this.configService.get<string>('INSTAGRAM_API_TOKEN') ||
      this.configService.get<string>('META_PAGE_ACCESS_TOKEN') ||
      this.configService.get<string>('WHATSAPP_API_TOKEN');

    if (!token) {
      return null;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}?fields=id,shortcode,permalink&access_token=${token}`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const shortcode = data?.shortcode;
        const permalink = data?.permalink;

        if (shortcode || permalink) {
          this.logger.log(
            `[Instagram Comment] Resolved Media ID "${mediaId}" via Graph API -> shortcode: "${shortcode}", permalink: "${permalink}"`,
          );

          // Find mapping by shortcode
          const conditions: any[] = [];
          if (shortcode) {
            conditions.push({ instagramMediaId: shortcode });
            conditions.push({ instagramMediaId: { contains: shortcode, mode: 'insensitive' } });
          }

          const resolvedMapping = await this.prisma.postPropertyMapping.findFirst({
            where: { OR: conditions },
            include: {
              property: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
          });

          if (resolvedMapping) {
            // Auto-cache the numeric media ID in post_property_mappings for instant zero-latency future lookups
            try {
              await this.prisma.postPropertyMapping.upsert({
                where: { instagramMediaId: mediaId },
                create: {
                  instagramMediaId: mediaId,
                  propertyId: resolvedMapping.propertyId,
                },
                update: {
                  propertyId: resolvedMapping.propertyId,
                },
              });
              this.logger.log(
                `[Instagram Comment] Auto-cached numeric Media ID "${mediaId}" to Property "${resolvedMapping.property?.title}" (${resolvedMapping.propertyId})`,
              );
            } catch (cacheErr: any) {
              this.logger.warn(`[Instagram Comment] Could not auto-cache mapping for "${mediaId}": ${cacheErr.message}`);
            }

            return resolvedMapping as MappingWithProperty;
          }
        }
      }
    } catch (err: any) {
      this.logger.debug(
        `[Instagram Comment] Graph API shortcode resolution failed for Media ID "${mediaId}": ${err.message}`,
      );
    }

    return null;
  }

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

    // 2. Look up or resolve PostPropertyMapping for the media ID
    const mapping = await this.resolveMappingForMedia(mediaId);

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

