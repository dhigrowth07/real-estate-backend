import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PhoneExtractionService } from '../../common/phone/phone-extraction.service';
import { MergeLeadsService } from '../../leads/merge-leads.service';
import { WhatsAppTemplateService } from '../../whatsapp/whatsapp-template.service';
import {
  ChannelType,
  LeadSource,
  LeadStage,
  MessageDirection,
  MessageStatus,
  MessageType,
  Lead,
} from '@prisma/client';

export interface InstagramMessagingWebhookEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: any[];
  };
  postback?: {
    mid?: string;
    payload?: string;
    title?: string;
  };
}

export interface InstagramDmProcessResult {
  leadId: string;
  conversationId: string;
  messageId: string;
  phoneExtracted: boolean;
  phone?: string;
  interestedPropertyId?: string;
  whatsappDeliveryEligible: boolean;
  merged?: boolean;
}

@Injectable()
export class InstagramMessagesHandler {
  private readonly logger = new Logger(InstagramMessagesHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly phoneExtractionService: PhoneExtractionService,
    private readonly mergeLeadsService: MergeLeadsService,
    private readonly whatsAppTemplateService: WhatsAppTemplateService,
  ) {}

  /**
   * Processes an incoming Instagram Direct Message webhook event
   */
  async handleInboundDm(
    event: InstagramMessagingWebhookEvent,
  ): Promise<InstagramDmProcessResult | null> {
    const senderId = event?.sender?.id;
    const messageObj = event?.message;
    const postbackObj = event?.postback;

    // Ignore echo messages (messages sent by our own business account)
    if (messageObj?.is_echo) {
      return null;
    }

    const externalMessageId = messageObj?.mid || postbackObj?.mid;
    const rawText = messageObj?.text?.trim() || postbackObj?.payload?.trim() || '';

    if (!senderId) {
      this.logger.warn('[Instagram Inbound DM] Missing sender ID. Skipping.');
      return null;
    }

    if (!externalMessageId && !rawText) {
      this.logger.warn(`[Instagram Inbound DM] Empty message payload from ${senderId}. Skipping.`);
      return null;
    }

    // 1. Deduplicate by externalMessageId
    if (externalMessageId) {
      const existingMessage = await this.prisma.message.findUnique({
        where: { externalMessageId },
      });

      if (existingMessage) {
        this.logger.log(
          `[Instagram Inbound DM] Message "${externalMessageId}" already processed. Skipping duplicate.`,
        );
        return null;
      }
    }

    // 2. Find existing Lead by instagramUserId, or create a new Unqualified Lead
    let lead = await this.prisma.lead.findUnique({
      where: { instagramUserId: senderId },
    });

    if (!lead) {
      lead = await this.prisma.lead.create({
        data: {
          name: `Instagram User (${senderId.slice(-4)})`,
          phone: '',
          source: LeadSource.INSTAGRAM,
          sources: ['Instagram'],
          stage: LeadStage.UNQUALIFIED,
          instagramUserId: senderId,
          budgetMin: 0,
          budgetMax: 0,
          preferredLocations: [],
        },
      });
      this.logger.log(
        `[Instagram Inbound DM] Created new Unqualified Lead "${lead.id}" for Instagram User "${senderId}"`,
      );
    }

    // 3. Find or create Conversation & store Message record
    const twentyFourHoursFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const conversation = await this.prisma.conversation.upsert({
      where: {
        channel_externalId: {
          channel: ChannelType.INSTAGRAM,
          externalId: senderId,
        },
      },
      create: {
        channel: ChannelType.INSTAGRAM,
        externalId: senderId,
        leadId: lead.id,
        windowOpenUntil: twentyFourHoursFromNow,
      },
      update: {
        leadId: lead.id,
        windowOpenUntil: twentyFourHoursFromNow,
      },
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        rawText: rawText || '[Media / Attachment]',
        messageType: MessageType.TEXT,
        externalMessageId: externalMessageId || null,
        status: MessageStatus.RECEIVED,
      },
    });

    // 4. Run the message text through PhoneExtractionService
    const phoneResult = this.phoneExtractionService.extractPhoneNumber(rawText);

    let phoneExtracted = false;
    let interestedPropertyId: string | undefined = lead.interestedPropertyId || undefined;
    let confirmationDmNeeded = false;
    let confirmationPropertyName = '';

    if (phoneResult.found && phoneResult.e164) {
      phoneExtracted = true;
      const formattedPhone = phoneResult.e164;

      this.logger.log(
        `[Instagram Inbound DM] Successfully extracted phone number "${formattedPhone}" from User "${senderId}"`,
      );

      // Look up most recent unresolved PendingInterest within the last 48 hours
      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

      const pendingInterests = await this.prisma.pendingInterest.findMany({
        where: {
          instagramUserId: senderId,
          resolved: false,
          createdAt: { gte: fortyEightHoursAgo },
        },
        include: {
          property: {
            select: {
              id: true,
              title: true,
              location: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (pendingInterests.length > 0) {
        const primaryInterest = pendingInterests[0];
        interestedPropertyId = primaryInterest.propertyId;
        confirmationPropertyName = primaryInterest.property?.title || 'the listing';

        // If multiple unresolved comments exist within 48h, mark for confirmation DM
        if (pendingInterests.length > 1) {
          confirmationDmNeeded = true;
          this.logger.warn(
            `[Instagram Inbound DM] User "${senderId}" has ${pendingInterests.length} unresolved comments. Taking most recent property "${confirmationPropertyName}" and queuing confirmation check.`,
          );
        }

        // Mark all pending interests in window as resolved
        await this.prisma.pendingInterest.updateMany({
          where: {
            id: { in: pendingInterests.map((p) => p.id) },
          },
          data: { resolved: true },
        });
      }

      // Ensure "Instagram" is present in sources array
      const currentSources = Array.isArray(lead.sources) ? [...lead.sources] : [];
      if (!currentSources.includes('Instagram')) {
        currentSources.push('Instagram');
      }

      // Update Lead with phone, consent evidence, and upgrade stage to NEW
      lead = await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          phone: formattedPhone,
          whatsappOptIn: true,
          whatsappOptInEvidence: rawText,
          stage: LeadStage.NEW,
          interestedPropertyId: interestedPropertyId || lead.interestedPropertyId,
          sources: currentSources,
        },
      });

      this.logger.log(
        `[Instagram Inbound DM] Upgraded Lead "${lead.id}" to stage "NEW", WhatsApp Opt-In verified, Property: "${interestedPropertyId || 'None'}".`,
      );

      // Check if duplicate lead exists with the same phone and merge
      const mergeResult = await this.mergeLeadsService.mergeLeadByPhone(
        lead.id,
        formattedPhone,
      );
      if (mergeResult.merged) {
        lead = mergeResult.primaryLead;
        interestedPropertyId = lead.interestedPropertyId || undefined;
        this.logger.log(
          `[Instagram Inbound DM] Cross-channel lead merge completed. Primary Lead ID is now "${lead.id}".`,
        );
      }

      if (confirmationDmNeeded) {
        // Record automated confirmation text message for the agent/system log
        this.logger.log(
          `[Instagram Confirmation DM] Template prompt: "Just to confirm, you're asking about our ${confirmationPropertyName}, right?"`,
        );
      }
    } else {
      this.logger.log(
        `[Instagram Inbound DM] No phone number detected in message from ${senderId}. Lead remains UNQUALIFIED.`,
      );
    }

    // 5. Check eligibility for Stage P2-9 Outbound WhatsApp Delivery
    // Eligible ONLY when all three conditions are true:
    // a. phone number present
    // b. whatsappOptIn = true
    // c. interestedPropertyId is set
    const isEligibleForWhatsAppDelivery = Boolean(
      lead.phone &&
      lead.whatsappOptIn &&
      lead.interestedPropertyId,
    );

    if (isEligibleForWhatsAppDelivery) {
      this.logger.log(
        `[Instagram Inbound DM] Lead "${lead.id}" is ELIGIBLE for Stage P2-9 Outbound WhatsApp delivery (Phone: ${lead.phone}, Property: ${lead.interestedPropertyId}).`,
      );
      this.triggerOutboundWhatsAppDeliveryHook(lead.id, lead.phone, lead.interestedPropertyId!);
    }

    return {
      leadId: lead.id,
      conversationId: conversation.id,
      messageId: message.id,
      phoneExtracted,
      phone: lead.phone || undefined,
      interestedPropertyId,
      whatsappDeliveryEligible: isEligibleForWhatsAppDelivery,
    };
  }

  /**
   * Hook for Stage P2-9 Outbound WhatsApp Catalog Delivery
   */
  private async triggerOutboundWhatsAppDeliveryHook(
    leadId: string,
    phone: string,
    propertyId: string,
  ): Promise<void> {
    this.logger.log(
      `[Stage P2-9 Trigger Hook] Initiating automated WhatsApp property brochure delivery to ${phone} for Lead ${leadId} (Property: ${propertyId})`,
    );
    try {
      await this.whatsAppTemplateService.sendPropertyDetailsTemplate(leadId);
    } catch (err: any) {
      this.logger.error(
        `[Stage P2-9 Outbound Delivery] Failed to send property details template to Lead ${leadId}: ${err.message}`,
      );
    }
  }
}
