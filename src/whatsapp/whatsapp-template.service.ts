import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import {
  ChannelType,
  MessageDirection,
  MessageStatus,
  MessageType,
  TemplateStatus,
  TemplateCategory,
  Lead,
  Property,
} from '@prisma/client';

export interface SendTemplateResult {
  success: boolean;
  messageId: string;
  externalMessageId: string;
  conversationId: string;
  leadId: string;
  templateName: string;
  renderedText: string;
  status: MessageStatus;
}

export interface MetaTemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters?: any[];
  sub_type?: string;
  index?: string;
}

@Injectable()
export class WhatsAppTemplateService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppTemplateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Seed default approved WhatsApp templates on startup if they don't exist
   */
  async onModuleInit() {
    await this.ensureDefaultTemplates();
  }

  /**
   * Seeds initial standard approved templates
   */
  async ensureDefaultTemplates() {
    const defaultTemplates = [
      {
        name: 'property_details_share',
        category: TemplateCategory.MARKETING,
        language: 'en',
        headerType: 'IMAGE',
        bodyText:
          'Hello {{1}},\n\nThank you for your interest in {{2}}!\n\n📍 Location: {{3}}\n🏠 Config: {{4}}\n💰 Price: {{5}}\n\nTap below to view full specifications, photos, and floor plans:\n{{6}}',
        variables: [
          'lead_name',
          'property_title',
          'location',
          'configuration',
          'price',
          'link',
        ],
        status: TemplateStatus.APPROVED,
      },
    ];

    for (const t of defaultTemplates) {
      const exists = await this.prisma.template.findUnique({
        where: { name: t.name },
      });
      if (!exists) {
        await this.prisma.template.create({ data: t });
        this.logger.log(
          `[WhatsAppTemplateService] Seeded default template "${t.name}" (${t.status}).`,
        );
      }
    }
  }

  /**
   * Hard guard: Verify WhatsApp opt-in status.
   * Throws BadRequestException immediately if opt-in is false or phone is missing.
   */
  public verifyWhatsAppOptInGuard(lead: {
    id: string;
    phone?: string | null;
    whatsappOptIn: boolean;
  }): void {
    if (!lead.phone || !lead.phone.trim()) {
      this.logger.warn(
        `[WhatsApp Guard] Rejected message send: Lead "${lead.id}" has no phone number.`,
      );
      throw new BadRequestException(
        `Cannot send WhatsApp message: Lead "${lead.id}" has no phone number.`,
      );
    }

    if (!lead.whatsappOptIn) {
      this.logger.warn(
        `[WhatsApp Guard] HARD GUARD TRIGGERED: Refused to send WhatsApp message to Lead "${lead.id}" because whatsappOptIn is false.`,
      );
      throw new BadRequestException(
        `Cannot send WhatsApp message: Lead "${lead.id}" has not opted in (whatsappOptIn is false). Outbound messaging is prohibited without verified consent.`,
      );
    }
  }

  /**
   * Sends the approved "property_details_share" WhatsApp template for a Lead's interested property.
   */
  async sendPropertyDetailsTemplate(leadId: string): Promise<SendTemplateResult> {
    // 1. Load Lead with interested property relation
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId, deletedAt: null },
      include: {
        interestedProperty: true,
      },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID ${leadId} not found`);
    }

    // 2. Enforce Hard Guard on Lead
    this.verifyWhatsAppOptInGuard(lead);

    // 3. Validate interested property
    const property = lead.interestedProperty;
    if (!property) {
      throw new BadRequestException(
        `Cannot send property details template: Lead "${leadId}" has no interested property linked (interestedPropertyId is null).`,
      );
    }

    // 4. Retrieve template definition from database
    const template = await this.prisma.template.findUnique({
      where: { name: 'property_details_share' },
    });

    if (!template) {
      throw new NotFoundException(
        `Template "property_details_share" not found in templates registry.`,
      );
    }

    if (template.status !== TemplateStatus.APPROVED) {
      throw new BadRequestException(
        `Cannot send template "${template.name}": Template status is "${template.status}" (must be APPROVED).`,
      );
    }

    // 5. Fill template variables
    const leadName = this.formatLeadDisplayName(lead.name);
    const propertyTitle = property.title;
    const location = property.location;
    const config = this.formatPropertyConfiguration(property);
    const priceFormatted = this.formatPrice(property.price);
    const frontendBaseUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const propertyLink = `${frontendBaseUrl}/properties/${property.id}`;

    const bodyParameters = [
      leadName,
      propertyTitle,
      location,
      config,
      priceFormatted,
      propertyLink,
    ];

    // Check primary image header
    const primaryImageUrl =
      Array.isArray(property.images) && property.images.length > 0
        ? property.images[0]
        : null;

    // Render text representation for logging
    const renderedText = this.interpolateTemplate(template.bodyText, bodyParameters);

    // 6. Dispatch message via BSP / Meta Cloud API
    const metaResponse = await this.dispatchMetaCloudApiTemplate({
      to: lead.phone,
      templateName: template.name,
      languageCode: template.language,
      headerImageUrl: primaryImageUrl,
      bodyParameters,
    });

    // 7. Upsert Conversation & Log outbound Message record
    const conversation = await this.prisma.conversation.upsert({
      where: {
        channel_externalId: {
          channel: ChannelType.WHATSAPP,
          externalId: lead.phone,
        },
      },
      create: {
        channel: ChannelType.WHATSAPP,
        externalId: lead.phone,
        leadId: lead.id,
      },
      update: {
        leadId: lead.id,
      },
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        rawText: renderedText,
        messageType: MessageType.TEMPLATE,
        externalMessageId: metaResponse.messageId,
        status: metaResponse.status,
      },
    });

    this.logger.log(
      `[WhatsAppTemplateService] Sent template "${template.name}" to Lead "${lead.id}" (${lead.phone}). Message ID: "${message.id}".`,
    );

    return {
      success: true,
      messageId: message.id,
      externalMessageId: metaResponse.messageId,
      conversationId: conversation.id,
      leadId: lead.id,
      templateName: template.name,
      renderedText,
      status: metaResponse.status,
    };
  }

  /**
   * Generic template sender enforcing the same hard guard
   */
  async sendGenericTemplate(
    leadId: string,
    templateName: string,
    parameters: string[],
    headerImageUrl?: string,
  ): Promise<SendTemplateResult> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId, deletedAt: null },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID ${leadId} not found`);
    }

    // Enforce Hard Guard
    this.verifyWhatsAppOptInGuard(lead);

    const template = await this.prisma.template.findUnique({
      where: { name: templateName },
    });

    if (!template) {
      throw new NotFoundException(`Template "${templateName}" not found.`);
    }

    if (template.status !== TemplateStatus.APPROVED) {
      throw new BadRequestException(
        `Template "${templateName}" is ${template.status}, not APPROVED.`,
      );
    }

    const renderedText = this.interpolateTemplate(template.bodyText, parameters);

    const metaResponse = await this.dispatchMetaCloudApiTemplate({
      to: lead.phone,
      templateName: template.name,
      languageCode: template.language,
      headerImageUrl,
      bodyParameters: parameters,
    });

    const conversation = await this.prisma.conversation.upsert({
      where: {
        channel_externalId: {
          channel: ChannelType.WHATSAPP,
          externalId: lead.phone,
        },
      },
      create: {
        channel: ChannelType.WHATSAPP,
        externalId: lead.phone,
        leadId: lead.id,
      },
      update: {
        leadId: lead.id,
      },
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        rawText: renderedText,
        messageType: MessageType.TEMPLATE,
        externalMessageId: metaResponse.messageId,
        status: metaResponse.status,
      },
    });

    return {
      success: true,
      messageId: message.id,
      externalMessageId: metaResponse.messageId,
      conversationId: conversation.id,
      leadId: lead.id,
      templateName: template.name,
      renderedText,
      status: metaResponse.status,
    };
  }

  /**
   * Calls Meta WhatsApp Cloud API or produces a simulated delivery response in dev/test
   */
  private async dispatchMetaCloudApiTemplate(params: {
    to: string;
    templateName: string;
    languageCode: string;
    headerImageUrl?: string | null;
    bodyParameters: string[];
  }): Promise<{ messageId: string; status: MessageStatus }> {
    const apiToken = this.configService.get<string>('WHATSAPP_API_TOKEN');
    const phoneNumberId = this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID');

    const cleanTo = params.to.replace(/\D/g, '');

    const components: MetaTemplateComponent[] = [];

    // Add image header if supported and available
    if (params.headerImageUrl) {
      components.push({
        type: 'header',
        parameters: [
          {
            type: 'image',
            image: { link: params.headerImageUrl },
          },
        ],
      });
    }

    // Add body parameters
    if (params.bodyParameters && params.bodyParameters.length > 0) {
      components.push({
        type: 'body',
        parameters: params.bodyParameters.map((param) => ({
          type: 'text',
          text: String(param),
        })),
      });
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanTo,
      type: 'template',
      template: {
        name: params.templateName,
        language: { code: params.languageCode || 'en' },
        components,
      },
    };

    if (apiToken && phoneNumberId) {
      try {
        const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json();
        if (!response.ok) {
          this.logger.error(
            `[Meta Cloud API Error] ${response.status}: ${JSON.stringify(data)}`,
          );
          return {
            messageId: `failed-${Date.now()}`,
            status: MessageStatus.FAILED,
          };
        }

        const externalId = data?.messages?.[0]?.id || `wamid.${Date.now()}`;
        return {
          messageId: externalId,
          status: MessageStatus.SENT,
        };
      } catch (err: any) {
        this.logger.error(`[WhatsApp API Network Error] ${err.message}`);
        return {
          messageId: `err-${Date.now()}`,
          status: MessageStatus.FAILED,
        };
      }
    }

    // Dev/Sandbox simulation when Meta API credentials are not provided
    const simulatedMessageId = `wamid.SIMULATED_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.logger.log(
      `[WhatsApp Template Sandbox] Simulated dispatch of "${params.templateName}" to "${cleanTo}". Generated ID: ${simulatedMessageId}`,
    );

    return {
      messageId: simulatedMessageId,
      status: MessageStatus.SENT,
    };
  }

  /**
   * Helper: Formats lead display name
   */
  private formatLeadDisplayName(name?: string): string {
    if (!name) return 'there';
    if (name.startsWith('Instagram User') || name.startsWith('WhatsApp User')) {
      return 'there';
    }
    return name.trim();
  }

  /**
   * Helper: Formats property configuration
   */
  private formatPropertyConfiguration(property: Property): string {
    const parts: string[] = [];
    if (property.bhk) parts.push(property.bhk);
    if (property.sqft) parts.push(`${property.sqft} sqft`);
    if (property.propertyType) {
      const typeFormatted = property.propertyType
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      if (parts.length === 0) parts.push(typeFormatted);
    }
    return parts.length > 0 ? parts.join(', ') : 'Standard Configuration';
  }

  /**
   * Helper: Formats Indian Rupee currency string
   */
  private formatPrice(price: number): string {
    if (!price || isNaN(price)) return 'Price on Request';
    if (price >= 10000000) {
      return `₹${(price / 10000000).toFixed(2)} Cr`;
    }
    if (price >= 100000) {
      return `₹${(price / 100000).toFixed(2)} Lakh`;
    }
    return `₹${Number(price).toLocaleString('en-IN')}`;
  }

  /**
   * Helper: Replaces {{1}}, {{2}} in body text with parameters
   */
  private interpolateTemplate(templateBody: string, params: string[]): string {
    let result = templateBody;
    params.forEach((param, index) => {
      const placeholder = new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g');
      result = result.replace(placeholder, param);
    });
    return result;
  }
}
