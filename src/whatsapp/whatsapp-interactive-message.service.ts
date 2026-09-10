import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import {
  ChannelType,
  MessageDirection,
  MessageStatus,
  MessageType,
} from '@prisma/client';

export interface WhatsAppButtonOption {
  id: string; // Unique ID returned in webhook response
  title: string; // Max 20 characters
}

export interface WhatsAppListRow {
  id: string; // Unique ID returned in webhook response
  title: string; // Max 24 characters
  description?: string; // Max 72 characters
}

export interface WhatsAppListSection {
  title?: string; // Max 24 characters
  rows: WhatsAppListRow[];
}

export interface SendInteractiveMessageResult {
  success: boolean;
  messageId: string;
  externalMessageId: string;
  conversationId: string;
  leadId?: string | null;
  renderedText: string;
  status: MessageStatus;
  error?: string;
}

export interface InteractiveMessageOptions {
  headerText?: string;
  footerText?: string;
  leadId?: string | null;
}

@Injectable()
export class WhatsAppInteractiveMessageService {
  private readonly logger = new Logger(WhatsAppInteractiveMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Sends an interactive button message (up to 3 reply buttons) via WhatsApp Cloud API.
   * Logs outbound message into Conversation and Message records.
   *
   * @param to - Recipient phone number in E.164 format
   * @param bodyText - Main text of the message
   * @param buttons - Array of 1 to 3 button options
   * @param options - Optional headerText, footerText, leadId
   */
  async sendButtonMessage(
    to: string,
    bodyText: string,
    buttons: WhatsAppButtonOption[],
    options?: InteractiveMessageOptions,
  ): Promise<SendInteractiveMessageResult> {
    if (!to || !to.trim()) {
      throw new BadRequestException('Recipient phone number is required');
    }

    if (!bodyText || !bodyText.trim()) {
      throw new BadRequestException('Body text is required for interactive button message');
    }

    if (!buttons || buttons.length === 0) {
      throw new BadRequestException('At least 1 button is required');
    }

    if (buttons.length > 3) {
      throw new BadRequestException(
        `WhatsApp interactive button messages allow a maximum of 3 buttons (received ${buttons.length})`,
      );
    }

    const cleanTo = to.trim();
    const digitsTo = cleanTo.replace(/\D/g, '');

    // Format Meta Interactive Button payload
    const actionButtons = buttons.map((btn) => ({
      type: 'reply',
      reply: {
        id: btn.id,
        title: btn.title.slice(0, 20), // Enforce Meta 20 char limit
      },
    }));

    const interactivePayload: any = {
      type: 'button',
      body: { text: bodyText },
      action: { buttons: actionButtons },
    };

    if (options?.headerText) {
      interactivePayload.header = {
        type: 'text',
        text: options.headerText.slice(0, 60),
      };
    }

    if (options?.footerText) {
      interactivePayload.footer = {
        text: options.footerText.slice(0, 60),
      };
    }

    const metaPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: digitsTo,
      type: 'interactive',
      interactive: interactivePayload,
    };

    // Dispatch Meta API request
    const metaResponse = await this.dispatchMetaCloudApi(metaPayload);

    // Render plain text representation for logging
    let renderedText = '';
    if (options?.headerText) renderedText += `${options.headerText}\n\n`;
    renderedText += bodyText;
    if (options?.footerText) renderedText += `\n\n_${options.footerText}_`;
    renderedText += `\n\n[Buttons: ${buttons.map((b) => `[${b.title}]`).join(' ')}]`;

    // Upsert Conversation & Log Outbound Message
    const conversation = await this.prisma.conversation.upsert({
      where: {
        channel_externalId: {
          channel: ChannelType.WHATSAPP,
          externalId: cleanTo,
        },
      },
      create: {
        channel: ChannelType.WHATSAPP,
        externalId: cleanTo,
        leadId: options?.leadId || null,
      },
      update: {
        leadId: options?.leadId || undefined,
      },
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        rawText: renderedText,
        messageType: MessageType.AUTO_REPLY,
        externalMessageId: metaResponse.messageId,
        status: metaResponse.status,
      },
    });

    const isSuccessful = metaResponse.status !== MessageStatus.FAILED;

    if (isSuccessful) {
      this.logger.log(
        `[WhatsAppInteractiveMessageService] Sent interactive button message to "${cleanTo}" (${buttons.length} buttons). Message ID: "${message.id}".`,
      );
    } else {
      this.logger.warn(
        `[WhatsAppInteractiveMessageService] Failed to dispatch interactive button message to "${cleanTo}". Message ID: "${message.id}". Error: ${metaResponse.error}`,
      );
    }

    return {
      success: isSuccessful,
      messageId: message.id,
      externalMessageId: metaResponse.messageId,
      conversationId: conversation.id,
      leadId: options?.leadId || null,
      renderedText,
      status: metaResponse.status,
      error: metaResponse.error,
    };
  }

  /**
   * Sends an interactive list message (up to 10 total items grouped in sections) via WhatsApp Cloud API.
   * Logs outbound message into Conversation and Message records.
   *
   * @param to - Recipient phone number in E.164 format
   * @param bodyText - Main text of the message
   * @param buttonText - Text displayed on the list drawer button (e.g. "Select Option", max 20 chars)
   * @param sections - Array of sections with row options (total rows <= 10)
   * @param options - Optional headerText, footerText, leadId
   */
  async sendListMessage(
    to: string,
    bodyText: string,
    buttonText: string,
    sections: WhatsAppListSection[],
    options?: InteractiveMessageOptions,
  ): Promise<SendInteractiveMessageResult> {
    if (!to || !to.trim()) {
      throw new BadRequestException('Recipient phone number is required');
    }

    if (!bodyText || !bodyText.trim()) {
      throw new BadRequestException('Body text is required for interactive list message');
    }

    if (!buttonText || !buttonText.trim()) {
      throw new BadRequestException('Button text is required for interactive list message');
    }

    if (!sections || sections.length === 0) {
      throw new BadRequestException('At least 1 section is required');
    }

    const totalRows = sections.reduce((acc, sec) => acc + (sec.rows?.length || 0), 0);
    if (totalRows === 0) {
      throw new BadRequestException('List message must contain at least 1 row option');
    }

    if (totalRows > 10) {
      throw new BadRequestException(
        `WhatsApp interactive list messages allow a maximum of 10 total rows across all sections (received ${totalRows})`,
      );
    }

    const cleanTo = to.trim();
    const digitsTo = cleanTo.replace(/\D/g, '');

    // Format Meta Interactive List payload
    const formattedSections = sections.map((sec, secIndex) => ({
      title: sec.title ? sec.title.slice(0, 24) : `Section ${secIndex + 1}`,
      rows: (sec.rows || []).map((row) => ({
        id: row.id,
        title: row.title.slice(0, 24),
        description: row.description ? row.description.slice(0, 72) : undefined,
      })),
    }));

    const interactivePayload: any = {
      type: 'list',
      body: { text: bodyText },
      action: {
        button: buttonText.slice(0, 20),
        sections: formattedSections,
      },
    };

    if (options?.headerText) {
      interactivePayload.header = {
        type: 'text',
        text: options.headerText.slice(0, 60),
      };
    }

    if (options?.footerText) {
      interactivePayload.footer = {
        text: options.footerText.slice(0, 60),
      };
    }

    const metaPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: digitsTo,
      type: 'interactive',
      interactive: interactivePayload,
    };

    // Dispatch Meta API request
    const metaResponse = await this.dispatchMetaCloudApi(metaPayload);

    // Render plain text representation for logging
    let renderedText = '';
    if (options?.headerText) renderedText += `${options.headerText}\n\n`;
    renderedText += bodyText;
    if (options?.footerText) renderedText += `\n\n_${options.footerText}_`;
    renderedText += `\n\n[List Menu: ${buttonText}]`;
    sections.forEach((sec) => {
      if (sec.title) renderedText += `\n*${sec.title}*`;
      sec.rows.forEach((r) => {
        renderedText += `\n• ${r.title}${r.description ? ` (${r.description})` : ''}`;
      });
    });

    // Upsert Conversation & Log Outbound Message
    const conversation = await this.prisma.conversation.upsert({
      where: {
        channel_externalId: {
          channel: ChannelType.WHATSAPP,
          externalId: cleanTo,
        },
      },
      create: {
        channel: ChannelType.WHATSAPP,
        externalId: cleanTo,
        leadId: options?.leadId || null,
      },
      update: {
        leadId: options?.leadId || undefined,
      },
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        rawText: renderedText,
        messageType: MessageType.AUTO_REPLY,
        externalMessageId: metaResponse.messageId,
        status: metaResponse.status,
      },
    });

    const isSuccessful = metaResponse.status !== MessageStatus.FAILED;

    if (isSuccessful) {
      this.logger.log(
        `[WhatsAppInteractiveMessageService] Sent interactive list message to "${cleanTo}" (${totalRows} options). Message ID: "${message.id}".`,
      );
    } else {
      this.logger.warn(
        `[WhatsAppInteractiveMessageService] Failed to dispatch interactive list message to "${cleanTo}". Message ID: "${message.id}". Error: ${metaResponse.error}`,
      );
    }

    return {
      success: isSuccessful,
      messageId: message.id,
      externalMessageId: metaResponse.messageId,
      conversationId: conversation.id,
      leadId: options?.leadId || null,
      renderedText,
      status: metaResponse.status,
      error: metaResponse.error,
    };
  }

  /**
   * Sends a standard text message via WhatsApp Cloud API.
   * Logs outbound message into Conversation and Message records.
   *
   * @param to - Recipient phone number in E.164 format
   * @param bodyText - Text content of the message
   * @param options - Optional leadId
   */
  async sendTextMessage(
    to: string,
    bodyText: string,
    options?: { leadId?: string | null },
  ): Promise<SendInteractiveMessageResult> {
    if (!to || !to.trim()) {
      throw new BadRequestException('Recipient phone number is required');
    }

    if (!bodyText || !bodyText.trim()) {
      throw new BadRequestException('Body text is required');
    }

    const cleanTo = to.trim();

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanTo,
      type: 'text',
      text: {
        preview_url: false,
        body: bodyText,
      },
    };

    const metaResponse = await this.dispatchMetaCloudApi(payload);

    // Upsert Conversation & Log Outbound Message
    const conversation = await this.prisma.conversation.upsert({
      where: {
        channel_externalId: {
          channel: ChannelType.WHATSAPP,
          externalId: cleanTo,
        },
      },
      create: {
        channel: ChannelType.WHATSAPP,
        externalId: cleanTo,
        leadId: options?.leadId || null,
      },
      update: {
        leadId: options?.leadId || undefined,
      },
    });

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        rawText: bodyText,
        messageType: MessageType.AUTO_REPLY,
        externalMessageId: metaResponse.messageId,
        status: metaResponse.status,
      },
    });

    const isSuccessful = metaResponse.status !== MessageStatus.FAILED;

    if (isSuccessful) {
      this.logger.log(
        `[WhatsAppInteractiveMessageService] Sent text message to "${cleanTo}". Message ID: "${message.id}".`,
      );
    } else {
      this.logger.warn(
        `[WhatsAppInteractiveMessageService] Failed to dispatch text message to "${cleanTo}". Message ID: "${message.id}". Error: ${metaResponse.error}`,
      );
    }

    return {
      success: isSuccessful,
      messageId: message.id,
      externalMessageId: metaResponse.messageId,
      conversationId: conversation.id,
      leadId: options?.leadId || null,
      renderedText: bodyText,
      status: metaResponse.status,
      error: metaResponse.error,
    };
  }

  /**
   * Helper: Dispatches Meta WhatsApp Cloud API request with fallback for simulated environments
   */
  private async dispatchMetaCloudApi(
    payload: any,
  ): Promise<{ messageId: string; status: MessageStatus; error?: string }> {
    const apiToken = this.configService.get<string>('WHATSAPP_API_TOKEN');
    const phoneNumberId = this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID');

    if (apiToken && phoneNumberId) {
      try {
        const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
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
          const isTokenExpired = data?.error?.code === 190 || response.status === 401;
          if (isTokenExpired) {
            this.logger.error(
              `[WhatsApp Cloud API Interactive Error] Meta Access Token has expired (Error 190 / 401). Please update WHATSAPP_API_TOKEN in your environment configuration.`,
            );
          } else {
            this.logger.error(
              `[WhatsApp Cloud API Interactive Error] Status ${response.status}: ${JSON.stringify(data)}`,
            );
          }

          return {
            messageId: `wamid.FAILED_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            status: MessageStatus.FAILED,
            error: data?.error?.message || `HTTP ${response.status} Error`,
          };
        }

        const externalMessageId =
          data?.messages?.[0]?.id ||
          `wamid.HBgL_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        return {
          messageId: externalMessageId,
          status: MessageStatus.SENT,
        };
      } catch (err: any) {
        this.logger.error(
          `[WhatsApp Cloud API Interactive Exception] ${err.message}`,
        );
        return {
          messageId: `wamid.FAILED_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          status: MessageStatus.FAILED,
          error: err.message,
        };
      }
    }

    // Simulated / Test Environment Response
    const mockMessageId = `wamid.SIMULATED_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.logger.log(
      `[WhatsAppInteractiveMessageService] Mock Mode: Simulated delivery with ID "${mockMessageId}".`,
    );

    return {
      messageId: mockMessageId,
      status: MessageStatus.SENT,
    };
  }
}
