import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PhoneExtractionService } from '../../common/phone/phone-extraction.service';
import { MatchesService } from '../../matches/matches.service';
import {
  ChannelType,
  LeadSource,
  LeadStage,
  MessageDirection,
  MessageStatus,
  MessageType,
  Lead,
} from '@prisma/client';

export interface WhatsAppIncomingMessage {
  from: string;
  id: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
  document?: { id?: string; filename?: string; caption?: string };
  audio?: { id?: string; voice?: boolean };
}

export interface WhatsAppWebhookContact {
  profile?: { name?: string };
  wa_id?: string;
}

export interface WhatsAppWebhookValue {
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: WhatsAppWebhookContact[];
  messages?: WhatsAppIncomingMessage[];
}

export interface WhatsAppProcessResult {
  leadId: string;
  conversationId: string;
  messageId: string;
  isNewLead: boolean;
  phone: string;
}

@Injectable()
export class WhatsAppMessagesHandler {
  private readonly logger = new Logger(WhatsAppMessagesHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly phoneExtractionService: PhoneExtractionService,
    private readonly matchesService: MatchesService,
  ) {}

  /**
   * Processes incoming WhatsApp Cloud API messages
   * 1. Deduplicates by WhatsApp message ID
   * 2. Normalizes sender phone number to E.164
   * 3. Finds or creates Lead (stage=NEW, source=WHATSAPP, opt-in=true)
   * 4. Upserts Conversation & refreshes 24-hour customer care session window
   * 5. Stores inbound Message record
   * 6. Triggers Matching Engine scan for new leads
   */
  async handleInboundMessage(
    msg: WhatsAppIncomingMessage,
    contacts?: WhatsAppWebhookContact[],
  ): Promise<WhatsAppProcessResult | null> {
    const messageId = msg?.id;
    const rawFrom = msg?.from;

    if (!messageId) {
      this.logger.warn('[WhatsApp Handler] Missing message ID in payload. Skipping.');
      return null;
    }

    if (!rawFrom) {
      this.logger.warn(`[WhatsApp Handler] Missing sender "from" on message ${messageId}. Skipping.`);
      return null;
    }

    // 1. Deduplicate by WhatsApp externalMessageId
    const existingMessage = await this.prisma.message.findUnique({
      where: { externalMessageId: messageId },
    });

    if (existingMessage) {
      this.logger.log(
        `[WhatsApp Handler] Message "${messageId}" already processed. Skipping duplicate.`,
      );
      return null;
    }

    // 2. Normalize sender phone number to E.164
    const normalizedPhone = this.normalizePhoneNumber(rawFrom);
    const rawText = this.extractMessageText(msg);

    // Get sender contact name from WhatsApp profile if provided
    const contactProfileName = contacts?.[0]?.profile?.name?.trim();
    const fallbackName = `WhatsApp User (${normalizedPhone.slice(-4)})`;
    const leadName = contactProfileName || fallbackName;

    // 3. Find existing Lead by phone or create new Lead
    let isNewLead = false;
    let lead = await this.prisma.lead.findFirst({
      where: {
        OR: [
          { phone: normalizedPhone },
          { phone: rawFrom },
          { phone: normalizedPhone.replace(/^\+/, '') },
        ],
        deletedAt: null,
      },
    });

    if (!lead) {
      isNewLead = true;
      lead = await this.prisma.lead.create({
        data: {
          name: leadName,
          phone: normalizedPhone,
          source: LeadSource.WHATSAPP,
          sources: ['WhatsApp'],
          stage: LeadStage.NEW,
          whatsappOptIn: true,
          whatsappOptInEvidence: rawText || 'Direct inbound WhatsApp message',
          budgetMin: 0,
          budgetMax: 0,
          preferredLocations: [],
        },
      });

      this.logger.log(
        `[WhatsApp Handler] Created new Lead "${lead.id}" (${lead.name}, ${normalizedPhone}) via WhatsApp.`,
      );
    } else {
      // Existing lead: Ensure "WhatsApp" is in sources and whatsappOptIn is marked true
      const currentSources = Array.isArray(lead.sources) ? [...lead.sources] : [];
      let needsUpdate = false;

      if (!currentSources.includes('WhatsApp')) {
        currentSources.push('WhatsApp');
        needsUpdate = true;
      }

      const updateData: any = {};
      if (needsUpdate) {
        updateData.sources = currentSources;
      }
      if (!lead.whatsappOptIn) {
        updateData.whatsappOptIn = true;
        updateData.whatsappOptInEvidence = rawText || 'Direct inbound WhatsApp message';
      }
      if (contactProfileName && (lead.name?.startsWith('Instagram User') || lead.name?.startsWith('WhatsApp User'))) {
        updateData.name = contactProfileName;
      }

      if (Object.keys(updateData).length > 0) {
        lead = await this.prisma.lead.update({
          where: { id: lead.id },
          data: updateData,
        });
      }
    }

    // 4. Find or create Conversation and refresh 24-hour window
    const twentyFourHoursFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const conversation = await this.prisma.conversation.upsert({
      where: {
        channel_externalId: {
          channel: ChannelType.WHATSAPP,
          externalId: normalizedPhone,
        },
      },
      create: {
        channel: ChannelType.WHATSAPP,
        externalId: normalizedPhone,
        leadId: lead.id,
        windowOpenUntil: twentyFourHoursFromNow,
      },
      update: {
        leadId: lead.id,
        windowOpenUntil: twentyFourHoursFromNow,
      },
    });

    // 5. Store Message record
    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.INBOUND,
        rawText: rawText || '[Media / Unsupported Content]',
        messageType: MessageType.TEXT,
        externalMessageId: messageId,
        status: MessageStatus.RECEIVED,
      },
    });

    this.logger.log(
      `[WhatsApp Handler] Logged Message "${message.id}" in Conversation "${conversation.id}" from "${normalizedPhone}"`,
    );

    // 6. Trigger Matching Engine for new leads
    if (isNewLead) {
      try {
        await this.matchesService.generateMatchesForLead(lead.id);
        this.logger.log(
          `[WhatsApp Handler] Triggered Matching Engine evaluation for new Lead "${lead.id}".`,
        );
      } catch (err: any) {
        this.logger.error(
          `[WhatsApp Handler] Failed to run Matching Engine for Lead "${lead.id}": ${err.message}`,
        );
      }
    }

    return {
      leadId: lead.id,
      conversationId: conversation.id,
      messageId: message.id,
      isNewLead,
      phone: normalizedPhone,
    };
  }

  /**
   * Normalizes raw sender phone string to E.164 format (+<country_code><number>)
   */
  private normalizePhoneNumber(raw: string): string {
    const trimmed = raw.trim();
    const phoneResult = this.phoneExtractionService.extractPhoneNumber(trimmed);
    if (phoneResult.found && phoneResult.e164) {
      return phoneResult.e164;
    }

    // Fallback E.164 standardization
    const digitsOnly = trimmed.replace(/\D/g, '');
    return `+${digitsOnly}`;
  }

  /**
   * Extracts readable text content from various WhatsApp message payloads
   */
  private extractMessageText(msg: WhatsAppIncomingMessage): string {
    if (msg.text?.body) {
      return msg.text.body.trim();
    }
    if (msg.button?.text) {
      return msg.button.text.trim();
    }
    if (msg.interactive?.button_reply?.title) {
      return msg.interactive.button_reply.title.trim();
    }
    if (msg.interactive?.list_reply?.title) {
      return msg.interactive.list_reply.title.trim();
    }
    if (msg.location) {
      const { name, address, latitude, longitude } = msg.location;
      return `[Location: ${name || ''} ${address || ''} (${latitude}, ${longitude})]`.trim();
    }
    if (msg.image?.caption) {
      return `[Image: ${msg.image.caption}]`;
    }
    if (msg.document?.filename || msg.document?.caption) {
      return `[Document: ${msg.document.filename || ''} ${msg.document.caption || ''}]`.trim();
    }
    if (msg.type) {
      return `[${msg.type.toUpperCase()}]`;
    }
    return '';
  }
}
