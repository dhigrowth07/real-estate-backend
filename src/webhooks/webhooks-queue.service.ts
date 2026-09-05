import { Injectable, Logger } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhookPlatform, WebhookStatus } from '@prisma/client';

export interface WebhookJobData {
  logId: string;
  platform: WebhookPlatform;
  payload: any;
  receivedAt: Date;
}

@Injectable()
export class WebhooksQueueService {
  private readonly logger = new Logger(WebhooksQueueService.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * Enqueues the webhook event for asynchronous background processing
   * Uses Node.js microtask/macro-queue execution to never block Meta's HTTP acknowledgment
   */
  enqueue(jobData: WebhookJobData): void {
    this.logger.log(
      `[Queue] Enqueued webhook job ${jobData.logId} for platform ${jobData.platform}`,
    );

    // Run asynchronously outside the HTTP request-response cycle
    setImmediate(async () => {
      try {
        await this.processJob(jobData);
      } catch (err: any) {
        this.logger.error(
          `[Queue] Unhandled error processing webhook job ${jobData.logId}: ${err.message}`,
          err.stack,
        );
      }
    });
  }

  /**
   * Dispatches the webhook event to the appropriate platform parser
   */
  private async processJob(job: WebhookJobData): Promise<void> {
    const { logId, platform, payload } = job;

    try {
      await this.webhooksService.updateLogStatus(logId, WebhookStatus.PROCESSING);

      if (platform === WebhookPlatform.WHATSAPP) {
        await this.processWhatsAppPayload(logId, payload);
      } else if (platform === WebhookPlatform.INSTAGRAM) {
        await this.processInstagramPayload(logId, payload);
      }

      await this.webhooksService.updateLogStatus(logId, WebhookStatus.PROCESSED);
      this.logger.log(`[Queue] Successfully processed webhook job ${logId}`);
    } catch (error: any) {
      this.logger.error(`[Queue] Webhook processing failed for ${logId}: ${error.message}`);
      await this.webhooksService.updateLogStatus(
        logId,
        WebhookStatus.FAILED,
        error.message || 'Unknown processing error',
      );
    }
  }

  /**
   * Processes WhatsApp Cloud API payload (messages, delivery statuses, media)
   */
  private async processWhatsAppPayload(logId: string, payload: any): Promise<void> {
    const entries = payload?.entry || [];

    for (const entry of entries) {
      const changes = entry?.changes || [];
      for (const change of changes) {
        const value = change?.value;
        if (!value) continue;

        // 1. Incoming Messages
        if (value.messages && Array.isArray(value.messages)) {
          for (const msg of value.messages) {
            this.logger.log(
              `[WhatsApp] Received message from ${msg.from} (Type: ${msg.type}, ID: ${msg.id})`,
            );
            // Extensible handler for lead capture / conversation bot in subsequent stages
          }
        }

        // 2. Status Updates (sent, delivered, read, failed)
        if (value.statuses && Array.isArray(value.statuses)) {
          for (const status of value.statuses) {
            this.logger.log(
              `[WhatsApp] Status update for message ${status.id}: ${status.status} (Recipient: ${status.recipient_id})`,
            );
          }
        }
      }
    }
  }

  /**
   * Processes Instagram Graph API payload (DMs & Comments)
   * Subscribes to BOTH "messages" and "comments" fields
   */
  private async processInstagramPayload(logId: string, payload: any): Promise<void> {
    const entries = payload?.entry || [];

    for (const entry of entries) {
      // 1. Instagram Direct Messages (entry.messaging)
      if (entry.messaging && Array.isArray(entry.messaging)) {
        for (const messagingEvent of entry.messaging) {
          const senderId = messagingEvent.sender?.id;
          const recipientId = messagingEvent.recipient?.id;

          if (messagingEvent.message) {
            this.logger.log(
              `[Instagram DM] Message received from ${senderId} -> ${recipientId}: "${messagingEvent.message.text || '[Media]'}"`,
            );
          } else if (messagingEvent.postback) {
            this.logger.log(
              `[Instagram DM] Postback received from ${senderId}: "${messagingEvent.postback.payload}"`,
            );
          }
        }
      }

      // 2. Instagram Feed / Post / Reel Comments (entry.changes)
      if (entry.changes && Array.isArray(entry.changes)) {
        for (const change of entry.changes) {
          const field = change.field;
          const value = change.value;

          if (field === 'comments') {
            this.logger.log(
              `[Instagram Comment] Comment ID ${value?.id} by @${value?.from?.username || value?.from?.id}: "${value?.text}" on Media ${value?.media?.id}`,
            );
          } else if (field === 'mentions') {
            this.logger.log(
              `[Instagram Mention] Account mentioned in comment/post ID: ${value?.comment_id || value?.media_id}`,
            );
          } else if (field === 'messages') {
            this.logger.log(`[Instagram Message Change] Field: ${field}`);
          } else {
            this.logger.log(`[Instagram Change] Field: ${field}`);
          }
        }
      }
    }
  }
}
