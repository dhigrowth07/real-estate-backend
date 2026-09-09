import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PhoneExtractionService } from '../../common/phone/phone-extraction.service';
import { MergeLeadsService } from '../../leads/merge-leads.service';
import { WhatsAppTemplateService } from '../../whatsapp/whatsapp-template.service';
import { MatchesService } from '../../matches/matches.service';
import {
  ChannelType,
  LeadSource,
  LeadStage,
  MessageDirection,
  MessageStatus,
  MessageType,
  NotificationType,
  InteractionChannel,
  InteractionType,
  UserRole,
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
  whatsappDelivered: boolean;
  whatsappDeliveryError?: string;
  manualFollowUpFlagged: boolean;
  merged?: boolean;
}

@Injectable()
export class InstagramMessagesHandler {
  private readonly logger = new Logger(InstagramMessagesHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly phoneExtractionService: PhoneExtractionService,
    private readonly mergeLeadsService: MergeLeadsService,
    private readonly whatsAppTemplateService: WhatsAppTemplateService,
    private readonly matchesService: MatchesService,
  ) {}

  /**
   * Processes an incoming Instagram Direct Message webhook event
   */
  async handleInboundDm(
    event: InstagramMessagingWebhookEvent | any,
  ): Promise<InstagramDmProcessResult | null> {
    const senderId =
      event?.sender?.id ||
      event?.from?.id ||
      event?.sender_id ||
      event?.user_id;
    const messageObj = event?.message;
    const postbackObj = event?.postback;

    this.logger.log(`[Instagram Inbound DM Event] Raw Event: ${JSON.stringify(event)}`);

    // Ignore echo messages (messages sent by our own business account)
    if (messageObj?.is_echo || event?.is_echo) {
      return null;
    }

    const directUsername =
      event?.sender?.username ||
      event?.from?.username ||
      event?.username ||
      event?.sender?.name ||
      event?.from?.name;

    const externalMessageId =
      messageObj?.mid ||
      postbackObj?.mid ||
      event?.id ||
      event?.mid;
    const rawText =
      messageObj?.text?.trim() ||
      postbackObj?.payload?.trim() ||
      event?.text?.trim() ||
      event?.body?.trim() ||
      '';

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
      const priorInterest = await this.prisma.pendingInterest.findFirst({
        where: { instagramUserId: senderId },
        orderBy: { createdAt: 'desc' },
      });

      const profile = await this.fetchInstagramUserProfile(senderId);
      const commenterUsername =
        directUsername || profile?.username || priorInterest?.commenterUsername;

      let initialName = `Instagram User (${senderId.slice(-4)})`;
      if (profile?.name) {
        initialName = profile.username
          ? `${profile.name} (@${profile.username})`
          : profile.name;
      } else if (commenterUsername) {
        initialName = commenterUsername.startsWith('@') ? commenterUsername : `@${commenterUsername}`;
      }

      lead = await this.prisma.lead.create({
        data: {
          name: initialName,
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
        `[Instagram Inbound DM] Created new Unqualified Lead "${lead.id}" (${initialName}) for Instagram User "${senderId}"`,
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

      // Resolve intelligent Lead Name from direct username, message text, Meta Graph API profile, or Instagram username
      let resolvedName = lead.name;
      const extractedName = this.extractNameFromMessage(rawText);
      const profile = await this.fetchInstagramUserProfile(senderId);
      const commenterUsername =
        directUsername ||
        profile?.username ||
        pendingInterests.find((p) => p.commenterUsername)?.commenterUsername;

      if (extractedName) {
        resolvedName = extractedName;
      } else if (profile?.name) {
        resolvedName = profile.username
          ? `${profile.name} (@${profile.username})`
          : profile.name;
      } else if (commenterUsername && (lead.name.startsWith('Instagram User') || !lead.name)) {
        resolvedName = commenterUsername.startsWith('@') ? commenterUsername : `@${commenterUsername}`;
      }

      // Ensure "Instagram" is present in sources array
      const currentSources = Array.isArray(lead.sources) ? [...lead.sources] : [];
      if (!currentSources.includes('Instagram')) {
        currentSources.push('Instagram');
      }

      // Update Lead with name, phone, consent evidence, and upgrade stage to NEW
      lead = await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          name: resolvedName,
          phone: formattedPhone,
          whatsappOptIn: true,
          whatsappOptInEvidence: rawText,
          stage: LeadStage.NEW,
          interestedPropertyId: interestedPropertyId || lead.interestedPropertyId,
          sources: currentSources,
        },
      });

      this.logger.log(
        `[Instagram Inbound DM] Upgraded Lead "${lead.id}" (${lead.name}) to stage "NEW", WhatsApp Opt-In verified, Property: "${interestedPropertyId || 'None'}".`,
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

      // STAGE P2-11: Explicit High-Confidence Match Creation & Additive Scoring
      if (lead.interestedPropertyId) {
        try {
          await this.matchesService.createExplicitMatch(
            lead.id,
            lead.interestedPropertyId,
          );
          this.logger.log(
            `[Stage P2-11 Explicit Match] Created explicit 100% Match for Lead "${lead.id}" and Property "${lead.interestedPropertyId}".`,
          );
        } catch (err: any) {
          this.logger.error(
            `[Stage P2-11 Explicit Match] Error creating explicit match for Lead "${lead.id}": ${err.message}`,
          );
        }
      }

      // Score this lead normally against all other properties
      try {
        await this.matchesService.generateMatchesForLead(lead.id);
      } catch (err: any) {
        this.logger.error(
          `[Instagram Inbound DM] Error running matching engine for Lead "${lead.id}": ${err.message}`,
        );
      }
    } else {
      this.logger.log(
        `[Instagram Inbound DM] No phone number detected in message from ${senderId}. Lead remains UNQUALIFIED.`,
      );
    }

    // =========================================================================
    // STEP 5: AUTOMATIC TRIGGER — OUTBOUND WHATSAPP PROPERTY BROCHURE
    // =========================================================================
    // Trigger WhatsAppTemplateService.sendPropertyDetailsTemplate(leadId)
    // immediately when all three conditions are satisfied in this processing run:
    // 1. Phone number is confirmed (lead.phone)
    // 2. WhatsApp opt-in consent verified (lead.whatsappOptIn === true)
    // 3. Interested property is identified (lead.interestedPropertyId)
    // =========================================================================
    let whatsappDelivered = false;
    let manualFollowUpFlagged = false;
    let whatsappDeliveryError: string | undefined;

    const isEligibleForWhatsAppDelivery = Boolean(
      lead.phone &&
      lead.phone.trim().length > 5 &&
      lead.whatsappOptIn &&
      lead.interestedPropertyId,
    );

    if (isEligibleForWhatsAppDelivery) {
      this.logger.log(
        `[Stage P2-10 Automatic Trigger] All 3 criteria met for Lead "${lead.id}" (Phone: ${lead.phone}, Property: ${lead.interestedPropertyId}). Dispatching WhatsApp brochure template...`,
      );

      try {
        await this.whatsAppTemplateService.sendPropertyDetailsTemplate(lead.id);
        whatsappDelivered = true;
        this.logger.log(
          `[Stage P2-10 Automatic Trigger] Successfully sent WhatsApp property details template to Lead "${lead.id}" (${lead.phone}).`,
        );
      } catch (err: any) {
        const errorMsg = err.message || 'WhatsApp template delivery failed';
        whatsappDeliveryError = errorMsg;
        manualFollowUpFlagged = true;

        this.logger.error(
          `[Stage P2-10 Automatic Trigger ERROR] Failed to send WhatsApp brochure to Lead "${lead.id}" (${lead.phone}): ${errorMsg}`,
        );

        // Flag the Lead for manual agent follow-up rather than failing silently
        await this.flagLeadForManualFollowUp(lead, errorMsg);
      }
    }

    return {
      leadId: lead.id,
      conversationId: conversation.id,
      messageId: message.id,
      phoneExtracted,
      phone: lead.phone || undefined,
      interestedPropertyId,
      whatsappDeliveryEligible: isEligibleForWhatsAppDelivery,
      whatsappDelivered,
      whatsappDeliveryError,
      manualFollowUpFlagged,
    };
  }

  /**
   * Flags a lead for manual agent follow-up when automatic template delivery fails.
   * Creates an internal Notification and logs an Interaction note.
   */
  private async flagLeadForManualFollowUp(lead: Lead, errorReason: string): Promise<void> {
    try {
      // Find assigned agent, or fallback to first Admin
      let targetUserId: string | null | undefined = lead.assignedAgentId;
      if (!targetUserId) {
        const adminUser = await this.prisma.user.findFirst({
          where: { role: UserRole.ADMIN },
        });
        targetUserId = adminUser ? adminUser.id : null;
      }

      if (targetUserId) {
        // 1. Create a high-priority system notification for the agent/admin
        await this.prisma.notification.create({
          data: {
            userId: targetUserId,
            type: NotificationType.SYSTEM,
            title: 'Action Needed: WhatsApp Brochure Failed',
            message: `Automatic WhatsApp brochure delivery failed for ${lead.name} (${lead.phone}): ${errorReason}. Please contact this lead manually.`,
            metadata: {
              leadId: lead.id,
              propertyId: lead.interestedPropertyId,
              error: errorReason,
            },
          },
        });

        // 2. Log an Interaction note on the lead record
        await this.prisma.interaction.create({
          data: {
            leadId: lead.id,
            agentId: targetUserId,
            channel: InteractionChannel.NOTE,
            type: InteractionType.FOLLOW_UP,
            notes: `⚠️ Automated WhatsApp property details delivery failed: "${errorReason}". Flagged for manual agent follow-up.`,
          },
        });

        this.logger.log(
          `[Stage P2-10 Manual Follow-Up] Flagged Lead "${lead.id}" for User "${targetUserId}". Created System Notification and Interaction note.`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `[Stage P2-10 Manual Follow-Up] Error creating follow-up notification for Lead "${lead.id}": ${err.message}`,
      );
    }
  }

  /**
   * Extracts a potential user name from freeform text messages:
   * 1. Explicit introductions: "My name is Dhinesh", "I am Alex", "Name: Dhinesh"
   * 2. Direct name + phone format: "Dhinesh 8056649692", "Dhinesh - 8056649692", "Dhinesh : +91 8056649692"
   * 3. Direct phone + name format: "8056649692 Dhinesh", "+91 8056649692 - Dhinesh Kumar"
   */
  private extractNameFromMessage(text: string): string | null {
    if (!text || typeof text !== 'string') return null;

    const stopWords = new Set([
      'hi', 'hello', 'hey', 'dear', 'sir', 'madam', 'bro', 'brother',
      'looking', 'interested', 'whatsapp', 'number', 'phone', 'sharing',
      'sending', 'contact', 'details', 'villa', 'house', 'apartment',
      'plot', 'flat', 'property', 'price', 'call', 'me', 'please',
      'send', 'more', 'info', 'information', 'bhk', 'sqft', 'crore',
      'lakh', 'budget', 'location', 'bangalore', 'chennai', 'hyderabad',
      'mumbai', 'delhi', 'pune', 'ready', 'move', 'possession',
    ]);

    // Pattern 1: Explicit introductions ("My name is Alex", "I am Dhinesh", "Name: Dhinesh")
    const explicitPatterns = [
      /(?:my name is|i am|i'm|this is|myself|name\s*[:\-])\s+([A-Za-z\s]{2,25})/i,
      /(?:^|\n)\s*(?:name\s*[:\-]?\s*)([A-Za-z\s]{2,25})/i,
    ];
    for (const pattern of explicitPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const cleaned = match[1].trim().replace(/[.,;!]$/, '');
        const words = cleaned.split(/\s+/).filter(Boolean);
        if (
          words.length >= 1 &&
          words.length <= 4 &&
          !words.some((w) => stopWords.has(w.toLowerCase()))
        ) {
          return words
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
        }
      }
    }

    // Pattern 2: "[Name] [Phone]" (e.g. "Dhinesh 8056649692", "Dhinesh - +91 8056649692")
    const nameBeforePhonePattern = /^\s*([A-Za-z\s]{2,25})\s*[-–:,]?\s*(?:\+?\d[\d\s-]{7,15})/i;
    const matchBefore = text.match(nameBeforePhonePattern);
    if (matchBefore && matchBefore[1]) {
      const cleaned = matchBefore[1]
        .trim()
        .replace(/^(hi|hello|hey)\s+/i, '')
        .replace(/[.,;!]$/, '');
      const words = cleaned.split(/\s+/).filter(Boolean);
      if (
        words.length >= 1 &&
        words.length <= 3 &&
        !words.some((w) => stopWords.has(w.toLowerCase()))
      ) {
        return words
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
      }
    }

    // Pattern 3: "[Phone] [Name]" (e.g. "8056649692 Dhinesh", "+918056649692 - Dhinesh Kumar")
    const nameAfterPhonePattern = /(?:\+?\d[\d\s-]{7,15})\s*[-–:,]?\s*([A-Za-z\s]{2,25})\s*$/i;
    const matchAfter = text.match(nameAfterPhonePattern);
    if (matchAfter && matchAfter[1]) {
      const cleaned = matchAfter[1].trim().replace(/[.,;!]$/, '');
      const words = cleaned.split(/\s+/).filter(Boolean);
      if (
        words.length >= 1 &&
        words.length <= 3 &&
        !words.some((w) => stopWords.has(w.toLowerCase()))
      ) {
        return words
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
      }
    }

    return null;
  }

  /**
   * Queries Meta Graph API to fetch the prospect's real name and public username
   */
  private async fetchInstagramUserProfile(
    igsid: string,
  ): Promise<{ name?: string; username?: string } | null> {
    const token =
      this.configService.get<string>('INSTAGRAM_API_TOKEN') ||
      this.configService.get<string>('META_PAGE_ACCESS_TOKEN') ||
      this.configService.get<string>('WHATSAPP_API_TOKEN');

    if (!token) {
      this.logger.warn(`[Instagram Profile] No API token configured for profile lookup.`);
      return null;
    }

    // Try Graph API endpoint variants for IGSID user profile
    const endpoints = [
      `https://graph.facebook.com/v20.0/${igsid}?fields=name,username,profile_pic&access_token=${token}`,
      `https://graph.instagram.com/v20.0/${igsid}?fields=id,username,name&access_token=${token}`,
      `https://graph.facebook.com/v20.0/${igsid}?fields=id,name&access_token=${token}`,
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          this.logger.log(`[Instagram Profile Lookup Success] IGSID ${igsid}: ${JSON.stringify(data)}`);
          return {
            name: data?.name || undefined,
            username: data?.username || undefined,
          };
        } else {
          const errBody = await res.text();
          this.logger.warn(
            `[Instagram Profile Lookup Attempt Failed] URL: ${url.split('?')[0]}, Status: ${res.status}, Body: ${errBody}`,
          );
        }
      } catch (err: any) {
        this.logger.warn(`[Instagram Profile Fetch Error] ${err.message}`);
      }
    }

    return null;
  }
}
