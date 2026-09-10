import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppInteractiveMessageService } from '../whatsapp/whatsapp-interactive-message.service';
import { BudgetBandService } from '../properties/budget-band.service';
import { MatchesService } from '../matches/matches.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import {
  ChannelType,
  LeadQualificationStatus,
  LeadStage,
  LeadUrgency,
  NotificationType,
  OnboardingStep,
  PropertyType,
  UserRole,
} from '@prisma/client';

export interface IncomingReplyMessage {
  text?: string;
  buttonId?: string;
  listId?: string;
  selectedId?: string;
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
}

export interface QualificationReplyResult {
  handled: boolean;
  onboardingStep?: OnboardingStep;
  advancedTo?: OnboardingStep;
  status?: LeadQualificationStatus;
  reprompted?: boolean;
  reason?: string;
  propertyType?: PropertyType;
  budget?: any;
  location?: string;
  urgency?: LeadUrgency;
  leadId?: string;
  conversationId?: string;
}

export const AGENT_REQUEST_KEYWORDS = [
  'agent',
  'human',
  'talk to someone',
  'representative',
  'support',
  'help',
  'speak with agent',
  'speak to an agent',
  'talk to agent',
  'call me',
  'advisor',
  'person',
  'executive',
  'customer care',
];

export const PROPERTY_TYPE_BUTTONS = [
  { id: 'prop_type_apartment', title: 'Apartment' },
  { id: 'prop_type_villa', title: 'Villa' },
  { id: 'prop_type_plot', title: 'Plot / Land' },
];

export const TIMELINE_BUTTONS = [
  { id: 'timeline_immediate', title: 'Immediate (< 1 mo)' },
  { id: 'timeline_3_months', title: 'Within 3 Months' },
  { id: 'timeline_exploring', title: 'Just Exploring' },
];

@Injectable()
export class LeadQualificationService {
  private readonly logger = new Logger(LeadQualificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsAppInteractiveMessageService: WhatsAppInteractiveMessageService,
    private readonly budgetBandService: BudgetBandService,
    @Inject(forwardRef(() => MatchesService))
    private readonly matchesService: MatchesService,
    @Inject(forwardRef(() => NotificationsGateway))
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  /**
   * Initiates the interactive WhatsApp qualification flow for a lead.
   * Sets onboardingStep to ASK_PROPERTY_TYPE and sends the property type buttons.
   */
  async startQualification(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID "${leadId}" not found`);
    }

    if (!lead.phone || !lead.phone.trim()) {
      throw new BadRequestException(`Lead "${leadId}" does not have a valid phone number for qualification`);
    }

    // Find or create active WhatsApp conversation
    const conversation = await this.prisma.conversation.upsert({
      where: {
        channel_externalId: {
          channel: ChannelType.WHATSAPP,
          externalId: lead.phone.trim(),
        },
      },
      create: {
        channel: ChannelType.WHATSAPP,
        externalId: lead.phone.trim(),
        leadId: lead.id,
        onboardingStep: OnboardingStep.ASK_PROPERTY_TYPE,
      },
      update: {
        leadId: lead.id,
        onboardingStep: OnboardingStep.ASK_PROPERTY_TYPE,
      },
    });

    // Update lead qualification status to IN_PROGRESS
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        qualificationStatus: LeadQualificationStatus.IN_PROGRESS,
      },
    });

    // Send Property Type Question with Buttons
    await this.whatsAppInteractiveMessageService.sendButtonMessage(
      lead.phone,
      "Hello! Welcome to our property service. Let's find your ideal property in just 4 quick steps.\n\nWhat type of property are you looking for?",
      PROPERTY_TYPE_BUTTONS,
      {
        headerText: 'Property Requirement (1/4)',
        footerText: 'Tap an option to proceed',
        leadId: lead.id,
      },
    );

    this.logger.log(
      `[LeadQualificationService] Started qualification flow for Lead "${lead.id}" (${lead.phone}). Sent ASK_PROPERTY_TYPE.`,
    );

    return {
      success: true,
      leadId: lead.id,
      conversationId: conversation.id,
      onboardingStep: OnboardingStep.ASK_PROPERTY_TYPE,
    };
  }

  /**
   * Main state machine entry point: processes incoming replies and progresses qualification.
   */
  async handleReply(
    conversationId: string,
    incomingMessage: string | IncomingReplyMessage,
  ): Promise<QualificationReplyResult> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        lead: true,
      },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation with ID "${conversationId}" not found`);
    }

    if (!conversation.lead) {
      this.logger.warn(
        `[LeadQualificationService] Conversation "${conversationId}" is not linked to any Lead. Skipping qualification.`,
      );
      return { handled: false, reason: 'NO_LINKED_LEAD' };
    }

    const lead = conversation.lead;
    const { rawText, selectedId } = this.extractMessageDetails(incomingMessage);

    // 1. FIRST: Check for Agent/Human request keywords case-insensitively
    if (this.isAgentRequest(rawText)) {
      this.logger.log(
        `[LeadQualificationService] Agent takeover requested by Lead "${lead.id}" with message: "${rawText}". Halting flow.`,
      );

      // Halt qualification flow
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          qualificationStatus: LeadQualificationStatus.REQUESTED_AGENT,
        },
      });

      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          onboardingStep: OnboardingStep.COMPLETE,
        },
      });

      // Trigger Alert / Notification for Agent & Admins
      await this.notifyAgentTakeover(lead, conversation.id, rawText);

      // Send acknowledgment to user
      if (lead.phone) {
        await this.whatsAppInteractiveMessageService.sendTextMessage(
          lead.phone,
          "Got it! We've paused the automated questions. A member of our team will get in touch with you shortly. 📞",
          { leadId: lead.id },
        );
      }

      return {
        handled: true,
        status: LeadQualificationStatus.REQUESTED_AGENT,
        onboardingStep: OnboardingStep.COMPLETE,
      };
    }

    // 2. Dispatch based on current onboardingStep
    switch (conversation.onboardingStep) {
      case OnboardingStep.NOT_STARTED: {
        const startRes = await this.startQualification(lead.id);
        return {
          handled: true,
          leadId: startRes.leadId,
          conversationId: startRes.conversationId,
          onboardingStep: startRes.onboardingStep,
        };
      }

      case OnboardingStep.ASK_PROPERTY_TYPE: {
        return this.handlePropertyTypeStep(lead, conversation, selectedId, rawText);
      }

      case OnboardingStep.ASK_BUDGET: {
        return this.handleBudgetStep(lead, conversation, selectedId, rawText);
      }

      case OnboardingStep.ASK_LOCATION: {
        return this.handleLocationStep(lead, conversation, selectedId, rawText);
      }

      case OnboardingStep.ASK_TIMELINE: {
        return this.handleTimelineStep(lead, conversation, selectedId, rawText);
      }

      case OnboardingStep.COMPLETE: {
        this.logger.log(
          `[LeadQualificationService] Lead "${lead.id}" qualification is already complete.`,
        );
        return {
          handled: false,
          onboardingStep: OnboardingStep.COMPLETE,
          reason: 'ALREADY_COMPLETED',
        };
      }

      default: {
        this.logger.warn(
          `[LeadQualificationService] Unknown onboarding step "${conversation.onboardingStep}".`,
        );
        return { handled: false, reason: 'UNKNOWN_STEP' };
      }
    }
  }

  /**
   * Handles Step 1: ASK_PROPERTY_TYPE reply
   */
  private async handlePropertyTypeStep(
    lead: any,
    conversation: any,
    selectedId: string | null,
    rawText: string,
  ) {
    const matchedType = this.parsePropertyType(selectedId, rawText);

    if (!matchedType) {
      // Re-prompt with clarification note
      this.logger.log(
        `[LeadQualificationService] Unrecognized property type reply ("${selectedId || rawText}"). Re-prompting Lead "${lead.id}".`,
      );

      await this.whatsAppInteractiveMessageService.sendButtonMessage(
        lead.phone,
        "Please tap one of the options below to choose your preferred property type:",
        PROPERTY_TYPE_BUTTONS,
        {
          headerText: 'Property Type Required (1/4)',
          footerText: 'Please select an option below',
          leadId: lead.id,
        },
      );

      return {
        handled: true,
        reprompted: true,
        onboardingStep: OnboardingStep.ASK_PROPERTY_TYPE,
      };
    }

    // Save property type
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: { propertyType: matchedType },
    });

    // Advance to ASK_BUDGET
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { onboardingStep: OnboardingStep.ASK_BUDGET },
    });

    // Generate Dynamic Budget Bands and send list message
    const bands = await this.budgetBandService.generateBudgetBands();
    const rows = bands.map((b) => ({
      id: b.id,
      title: b.label.slice(0, 24),
      description: b.max
        ? `Up to ₹${(b.max / 100000).toLocaleString('en-IN')} Lakhs`
        : 'Premium Luxury',
    }));

    await this.whatsAppInteractiveMessageService.sendListMessage(
      lead.phone,
      'Great choice! What is your planned budget range for this property?',
      'Select Budget',
      [{ title: 'Available Price Ranges', rows }],
      {
        headerText: 'Budget Range (2/4)',
        footerText: 'Tap the button to choose a price band',
        leadId: lead.id,
      },
    );

    return {
      handled: true,
      advancedTo: OnboardingStep.ASK_BUDGET,
      propertyType: matchedType,
    };
  }

  /**
   * Handles Step 2: ASK_BUDGET reply
   */
  private async handleBudgetStep(
    lead: any,
    conversation: any,
    selectedId: string | null,
    rawText: string,
  ) {
    const bands = await this.budgetBandService.generateBudgetBands();
    const matchedBand = bands.find(
      (b) =>
        b.id === selectedId ||
        (selectedId && selectedId.includes(b.id)) ||
        b.label.toLowerCase() === rawText.toLowerCase().trim(),
    );

    if (!matchedBand) {
      // Re-prompt with clarification note
      this.logger.log(
        `[LeadQualificationService] Unrecognized budget selection ("${selectedId || rawText}"). Re-prompting Lead "${lead.id}".`,
      );

      const rows = bands.map((b) => ({
        id: b.id,
        title: b.label.slice(0, 24),
        description: b.max
          ? `Up to ₹${(b.max / 100000).toLocaleString('en-IN')} Lakhs`
          : 'Premium Luxury',
      }));

      await this.whatsAppInteractiveMessageService.sendListMessage(
        lead.phone,
        'Please select one of the budget options from the list below to help us find matching properties in your range:',
        'Select Budget',
        [{ title: 'Available Price Ranges', rows }],
        {
          headerText: 'Budget Selection (2/4)',
          footerText: 'Please tap the button to choose',
          leadId: lead.id,
        },
      );

      return {
        handled: true,
        reprompted: true,
        onboardingStep: OnboardingStep.ASK_BUDGET,
      };
    }

    // Save budgetMin & budgetMax
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        budgetMin: matchedBand.min,
        budgetMax: matchedBand.max,
      },
    });

    // Advance to ASK_LOCATION
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { onboardingStep: OnboardingStep.ASK_LOCATION },
    });

    // Send Location Question (Free text / open-ended prompt)
    await this.whatsAppInteractiveMessageService.sendTextMessage(
      lead.phone,
      "Got it! 📍 Which location or neighborhood are you looking in?\n\n(Reply with area name e.g. 'Whitefield', 'Indiranagar', or reply 'Any' if flexible)",
      { leadId: lead.id },
    );

    return {
      handled: true,
      advancedTo: OnboardingStep.ASK_LOCATION,
      budget: matchedBand,
    };
  }

  /**
   * Handles Step 3: ASK_LOCATION reply (Free text or list selection)
   */
  private async handleLocationStep(
    lead: any,
    conversation: any,
    selectedId: string | null,
    rawText: string,
  ) {
    const rawLocation = (rawText || selectedId || 'Any').trim();
    const locationValue = rawLocation.length > 0 ? rawLocation : 'Any';

    // Store preferred locations array
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        preferredLocations: [locationValue],
      },
    });

    // Advance to ASK_TIMELINE
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { onboardingStep: OnboardingStep.ASK_TIMELINE },
    });

    // Send Timeline Question with Buttons
    await this.whatsAppInteractiveMessageService.sendButtonMessage(
      lead.phone,
      'Almost done! ⏳ When are you planning to buy or move in?',
      TIMELINE_BUTTONS,
      {
        headerText: 'Purchase Timeline (4/4)',
        footerText: 'Tap an option to finish',
        leadId: lead.id,
      },
    );

    return {
      handled: true,
      advancedTo: OnboardingStep.ASK_TIMELINE,
      location: locationValue,
    };
  }

  /**
   * Handles Step 4: ASK_TIMELINE reply
   */
  private async handleTimelineStep(
    lead: any,
    conversation: any,
    selectedId: string | null,
    rawText: string,
  ) {
    const matchedUrgency = this.parseTimeline(selectedId, rawText);

    if (!matchedUrgency) {
      // Re-prompt with clarification note
      this.logger.log(
        `[LeadQualificationService] Unrecognized timeline selection ("${selectedId || rawText}"). Re-prompting Lead "${lead.id}".`,
      );

      await this.whatsAppInteractiveMessageService.sendButtonMessage(
        lead.phone,
        'Please tap one of the timeline options below so we can prioritize your search:',
        TIMELINE_BUTTONS,
        {
          headerText: 'Timeline Required (4/4)',
          footerText: 'Please select an option',
          leadId: lead.id,
        },
      );

      return {
        handled: true,
        reprompted: true,
        onboardingStep: OnboardingStep.ASK_TIMELINE,
      };
    }

    // Save Urgency, mark Lead QUALIFIED and stage REQUIREMENT_GATHERED
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        urgency: matchedUrgency,
        qualificationStatus: LeadQualificationStatus.QUALIFIED,
        stage: LeadStage.REQUIREMENT_GATHERED,
      },
    });

    // Mark conversation COMPLETE
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        onboardingStep: OnboardingStep.COMPLETE,
      },
    });

    // Send completion celebration message
    await this.whatsAppInteractiveMessageService.sendTextMessage(
      lead.phone,
      "🎉 Thank you! Your preferences have been saved. Our matching engine is scanning our inventory for the best properties matching your requirements now! 🚀",
      { leadId: lead.id },
    );

    // Trigger Phase 1 Matching Engine Scan
    this.logger.log(
      `[LeadQualificationService] Lead "${lead.id}" fully qualified. Triggering Matching Engine.`,
    );
    try {
      await this.matchesService.generateMatchesForLead(lead.id);
    } catch (err: any) {
      this.logger.error(
        `[LeadQualificationService] Error triggering matching engine for Lead "${lead.id}": ${err.message}`,
      );
    }

    return {
      handled: true,
      status: LeadQualificationStatus.QUALIFIED,
      onboardingStep: OnboardingStep.COMPLETE,
      urgency: matchedUrgency,
    };
  }

  /**
   * Helper: Dispatches Real-Time Alert to Agents/Admins when Lead requests human takeover
   */
  private async notifyAgentTakeover(lead: any, conversationId: string, lastMessage: string) {
    const recipientIds = new Set<string>();

    if (lead.assignedAgentId) {
      recipientIds.add(lead.assignedAgentId);
    } else {
      // Find all Admins
      const admins = await this.prisma.user.findMany({
        where: { role: UserRole.ADMIN },
        select: { id: true },
      });
      admins.forEach((admin) => recipientIds.add(admin.id));
    }

    const title = '👤 Human Agent Requested';
    const message = `Lead "${lead.name || lead.phone}" requested human agent support during WhatsApp qualification.`;

    for (const userId of recipientIds) {
      const notification = await this.prisma.notification.create({
        data: {
          userId,
          type: NotificationType.SYSTEM,
          title,
          message,
          metadata: {
            leadId: lead.id,
            leadName: lead.name,
            leadPhone: lead.phone,
            conversationId,
            lastMessage,
            reason: 'QUALIFICATION_INTERRUPTED_AGENT_REQUEST',
          },
        },
      });

      if (this.notificationsGateway) {
        this.notificationsGateway.sendToUser(userId, 'notification', notification);
      }
    }
  }

  /**
   * Helper: Checks if text matches agent takeover keywords case-insensitively
   */
  private isAgentRequest(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase().trim();
    return AGENT_REQUEST_KEYWORDS.some((kw) => lower.includes(kw));
  }

  /**
   * Helper: Extracts rawText and selectedId from various message formats
   */
  private extractMessageDetails(incoming: string | IncomingReplyMessage): {
    rawText: string;
    selectedId: string | null;
  } {
    if (typeof incoming === 'string') {
      const trimmed = incoming.trim();
      return { rawText: trimmed, selectedId: trimmed };
    }

    const selectedId =
      incoming.buttonId ||
      incoming.listId ||
      incoming.selectedId ||
      incoming.interactive?.button_reply?.id ||
      incoming.interactive?.list_reply?.id ||
      null;

    const rawText =
      incoming.text ||
      incoming.interactive?.button_reply?.title ||
      incoming.interactive?.list_reply?.title ||
      selectedId ||
      '';

    return {
      rawText: rawText.trim(),
      selectedId,
    };
  }

  /**
   * Helper: Parses property type button ID or text
   */
  private parsePropertyType(selectedId: string | null, rawText: string): PropertyType | null {
    const id = (selectedId || '').toLowerCase().trim();
    const text = (rawText || '').toLowerCase().trim();

    if (id === 'prop_type_apartment' || text === 'apartment' || text === 'apartments' || text === 'flat') {
      return PropertyType.APARTMENT;
    }
    if (id === 'prop_type_villa' || text === 'villa' || text === 'villas' || text === 'house') {
      return PropertyType.VILLA;
    }
    if (id === 'prop_type_plot' || text === 'plot' || text === 'plots' || text === 'land') {
      return PropertyType.PLOT;
    }
    if (id === 'prop_type_commercial' || text === 'commercial') {
      return PropertyType.COMMERCIAL;
    }
    if (id === 'prop_type_independent_house' || text === 'independent house') {
      return PropertyType.INDEPENDENT_HOUSE;
    }

    return null;
  }

  /**
   * Helper: Parses timeline button ID or text
   */
  private parseTimeline(selectedId: string | null, rawText: string): LeadUrgency | null {
    const id = (selectedId || '').toLowerCase().trim();
    const text = (rawText || '').toLowerCase().trim();

    if (
      id === 'timeline_immediate' ||
      text === 'immediate (< 1 mo)' ||
      text === 'immediate' ||
      text === '< 1 month' ||
      text === '< 1 mo' ||
      text === '1 month' ||
      text === 'urgent'
    ) {
      return LeadUrgency.IMMEDIATE;
    }

    if (
      id === 'timeline_3_months' ||
      text === '1-3 months' ||
      text === '1 - 3 months' ||
      text === 'within 3 months' ||
      text === '3 months'
    ) {
      return LeadUrgency.WITHIN_3_MONTHS;
    }

    if (
      id === 'timeline_exploring' ||
      text === 'just exploring' ||
      text === 'exploring' ||
      text === '> 3 months' ||
      text === 'browsing'
    ) {
      return LeadUrgency.EXPLORING;
    }

    return null;
  }
}
