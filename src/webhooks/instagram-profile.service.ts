import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface InstagramProfile {
  name?: string | null;
  username?: string | null;
  profilePic?: string | null;
}

interface CacheEntry {
  profile: InstagramProfile;
  expiresAt: number;
}

@Injectable()
export class InstagramProfileService {
  private readonly logger = new Logger(InstagramProfileService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;

  constructor(private readonly configService: ConfigService) {
    // Cache profile data for 24 hours by default
    const ttlHours = this.configService.get<number>('INSTAGRAM_PROFILE_CACHE_TTL_HOURS') || 24;
    this.cacheTtlMs = ttlHours * 60 * 60 * 1000;
  }

  /**
   * Fetches the public name, username, and profile picture for an Instagram-scoped user ID (IGSID).
   * Caches results in memory to avoid repetitive API round-trips.
   *
   * @param instagramUserId - Meta Instagram-scoped user ID (IGSID)
   * @returns InstagramProfile or null if lookup fails
   */
  async getProfile(instagramUserId: string): Promise<InstagramProfile | null> {
    if (!instagramUserId || !instagramUserId.trim()) {
      return null;
    }

    const cleanId = instagramUserId.trim();

    // 1. Check in-memory cache
    const cached = this.cache.get(cleanId);
    if (cached) {
      if (Date.now() < cached.expiresAt) {
        this.logger.debug(`[InstagramProfileService] Cache HIT for IGSID "${cleanId}".`);
        return cached.profile;
      }
      // Expired entry
      this.cache.delete(cleanId);
    }

    // 2. Resolve Graph API token
    const token =
      this.configService.get<string>('INSTAGRAM_API_TOKEN') ||
      this.configService.get<string>('META_PAGE_ACCESS_TOKEN') ||
      this.configService.get<string>('WHATSAPP_API_TOKEN');

    if (!token) {
      this.logger.warn(`[InstagramProfileService] No API token configured for profile lookup.`);
      return null;
    }

    // 3. Query Graph API endpoints
    const endpoints = [
      `https://graph.facebook.com/v21.0/${cleanId}?fields=name,username,profile_pic&access_token=${token}`,
      `https://graph.facebook.com/v20.0/${cleanId}?fields=name,username,profile_pic&access_token=${token}`,
      `https://graph.instagram.com/v20.0/${cleanId}?fields=id,username,name,profile_picture_url&access_token=${token}`,
      `https://graph.facebook.com/v20.0/${cleanId}?fields=id,name&access_token=${token}`,
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const profile: InstagramProfile = {
            name: data?.name?.trim() || null,
            username: data?.username?.trim() || null,
            profilePic: data?.profile_pic || data?.profile_picture_url || null,
          };

          this.logger.log(
            `[InstagramProfileService] Successfully fetched profile for IGSID "${cleanId}": ${JSON.stringify(profile)}`,
          );

          // Save to cache
          this.setCache(cleanId, profile);
          return profile;
        } else {
          const errBody = await res.text();
          this.logger.warn(
            `[InstagramProfileService] Lookup failed on ${url.split('?')[0]}: Status ${res.status} - ${errBody}`,
          );
        }
      } catch (err: any) {
        this.logger.warn(
          `[InstagramProfileService] Error querying Instagram Graph API for "${cleanId}": ${err.message}`,
        );
      }
    }

    return null;
  }

  /**
   * Helper to store entry in cache with TTL and enforce cache size bounds
   */
  private setCache(id: string, profile: InstagramProfile): void {
    if (this.cache.size > 5000) {
      // Remove oldest entries when reaching high threshold
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(id, {
      profile,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  /**
   * Helper to clear cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }
}
