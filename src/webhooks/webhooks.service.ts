import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookPlatform, WebhookStatus, WebhookLog } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Validates Meta's webhook verification handshake challenge (GET request)
   */
  verifyHandshake(
    platform: WebhookPlatform,
    query: Record<string, any>,
  ): { isValid: boolean; challenge?: string } {
    const mode = query['hub.mode'] || query['hub_mode'];
    const verifyToken = query['hub.verify_token'] || query['hub_verify_token'];
    const challenge = query['hub.challenge'] || query['hub_challenge'];

    if (mode !== 'subscribe') {
      this.logger.warn(`[${platform}] Rejected handshake: invalid mode "${mode}"`);
      return { isValid: false };
    }

    const expectedToken = this.getExpectedVerifyToken(platform);

    if (!expectedToken) {
      this.logger.error(
        `[${platform}] Webhook verify token not configured in environment variables (META_VERIFY_TOKEN / ${platform}_VERIFY_TOKEN)`,
      );
      return { isValid: false };
    }

    if (verifyToken !== expectedToken) {
      this.logger.warn(
        `[${platform}] Rejected handshake: Token mismatch. Received "${verifyToken}"`,
      );
      return { isValid: false };
    }

    this.logger.log(`[${platform}] Verification handshake succeeded. Returning challenge.`);
    return { isValid: true, challenge: String(challenge) };
  }

  /**
   * Verifies the X-Hub-Signature-256 header using HMAC-SHA256 against the Meta App Secret
   */
  verifySignature(
    platform: WebhookPlatform,
    rawBody: Buffer | string | undefined,
    signatureHeader: string | undefined,
  ): boolean {
    const appSecret = this.getAppSecret(platform);

    // In local dev without secret configured, log warning but allow if configured
    if (!appSecret) {
      this.logger.warn(
        `[${platform}] Meta App Secret not set. Skipping cryptographic signature check for dev. Set META_APP_SECRET to enforce.`,
      );
      return true;
    }

    if (!signatureHeader) {
      this.logger.error(`[${platform}] Missing X-Hub-Signature-256 header on incoming webhook`);
      return false;
    }

    if (!signatureHeader.startsWith('sha256=')) {
      this.logger.error(`[${platform}] Invalid signature format. Expected "sha256=..."`);
      return false;
    }

    const signatureHex = signatureHeader.replace(/^sha256=/, '').trim();

    if (!rawBody) {
      this.logger.error(`[${platform}] Raw request body is empty. Cannot verify signature.`);
      return false;
    }

    try {
      const hmac = crypto.createHmac('sha256', appSecret);
      if (Buffer.isBuffer(rawBody)) {
        hmac.update(rawBody);
      } else {
        hmac.update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody));
      }
      const calculatedHex = hmac.digest('hex');

      const signatureBuffer = Buffer.from(signatureHex, 'hex');
      const calculatedBuffer = Buffer.from(calculatedHex, 'hex');

      if (signatureBuffer.length !== calculatedBuffer.length) {
        this.logger.warn(`[${platform}] Signature length mismatch`);
        return false;
      }

      const isValid = crypto.timingSafeEqual(signatureBuffer, calculatedBuffer);
      if (!isValid) {
        this.logger.warn(`[${platform}] HMAC-SHA256 signature verification failed.`);
      }
      return isValid;
    } catch (err: any) {
      this.logger.error(`[${platform}] Error verifying HMAC signature: ${err.message}`);
      return false;
    }
  }

  /**
   * Logs every raw incoming payload to webhook_logs before any parsing or processing
   */
  async logRawPayload(
    platform: WebhookPlatform,
    rawPayload: any,
    headers?: Record<string, any>,
  ): Promise<WebhookLog> {
    const eventType = this.detectEventType(platform, rawPayload);

    // Sanitize headers to avoid storing sensitive cookies or authorization headers
    const sanitizedHeaders = headers
      ? {
          'x-hub-signature-256': headers['x-hub-signature-256'],
          'user-agent': headers['user-agent'],
          'content-type': headers['content-type'],
          host: headers['host'],
        }
      : undefined;

    return this.prisma.webhookLog.create({
      data: {
        platform,
        eventType,
        rawPayload: rawPayload ?? {},
        headers: sanitizedHeaders,
        status: WebhookStatus.RECEIVED,
      },
    });
  }

  /**
   * Update the status of a webhook log after processing
   */
  async updateLogStatus(
    logId: string,
    status: WebhookStatus,
    error?: string,
  ): Promise<WebhookLog> {
    return this.prisma.webhookLog.update({
      where: { id: logId },
      data: {
        status,
        error: error || null,
        processedAt: status === WebhookStatus.PROCESSED || status === WebhookStatus.FAILED ? new Date() : undefined,
      },
    });
  }

  /**
   * List recent webhook logs for admin monitoring and diagnostics
   */
  async getRecentLogs(limit = 50) {
    return this.prisma.webhookLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Automatically detect the event category (e.g. messages, comments, statuses)
   */
  private detectEventType(platform: WebhookPlatform, payload: any): string | undefined {
    if (!payload || typeof payload !== 'object') return undefined;

    if (platform === WebhookPlatform.WHATSAPP) {
      const change = payload.entry?.[0]?.changes?.[0];
      if (change?.field) {
        if (change.value?.messages) return 'messages';
        if (change.value?.statuses) return 'statuses';
        return change.field;
      }
      return 'whatsapp_event';
    }

    if (platform === WebhookPlatform.INSTAGRAM) {
      // Instagram Graph API webhook structure
      const entry = payload.entry?.[0];
      if (entry?.messaging) {
        return 'messages'; // Direct Message event
      }
      const change = entry?.changes?.[0];
      if (change?.field) {
        // e.g. "comments", "mentions", "messages", "story_insights"
        return change.field;
      }
      return 'instagram_event';
    }

    return undefined;
  }

  private getExpectedVerifyToken(platform: WebhookPlatform): string | undefined {
    if (platform === WebhookPlatform.WHATSAPP) {
      return (
        this.configService.get<string>('WHATSAPP_VERIFY_TOKEN') ||
        this.configService.get<string>('META_VERIFY_TOKEN') ||
        'infragen_meta_verify_token_2026'
      );
    }
    if (platform === WebhookPlatform.INSTAGRAM) {
      return (
        this.configService.get<string>('INSTAGRAM_VERIFY_TOKEN') ||
        this.configService.get<string>('META_VERIFY_TOKEN') ||
        'infragen_meta_verify_token_2026'
      );
    }
    return this.configService.get<string>('META_VERIFY_TOKEN');
  }

  private getAppSecret(platform: WebhookPlatform): string | undefined {
    if (platform === WebhookPlatform.WHATSAPP) {
      return (
        this.configService.get<string>('WHATSAPP_APP_SECRET') ||
        this.configService.get<string>('META_APP_SECRET')
      );
    }
    if (platform === WebhookPlatform.INSTAGRAM) {
      return (
        this.configService.get<string>('INSTAGRAM_APP_SECRET') ||
        this.configService.get<string>('META_APP_SECRET')
      );
    }
    return this.configService.get<string>('META_APP_SECRET');
  }
}
