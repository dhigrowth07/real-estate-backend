import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  HttpStatus,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { WebhooksService } from './webhooks.service';
import { WebhooksQueueService } from './webhooks-queue.service';
import { WebhookVerifyDto } from './dto/webhook-verify.dto';
import { WebhookPlatform } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly webhooksQueueService: WebhooksQueueService,
  ) {}

  // ---------------------------------------------------------------------------
  // WHATSAPP WEBHOOKS
  // ---------------------------------------------------------------------------

  /**
   * WhatsApp Webhook Verification Handshake (GET)
   * Meta sends hub.mode, hub.verify_token, hub.challenge
   */
  @Get('whatsapp')
  verifyWhatsAppWebhook(@Query() query: WebhookVerifyDto, @Res() res: Response) {
    const result = this.webhooksService.verifyHandshake(WebhookPlatform.WHATSAPP, query);

    if (result.isValid && result.challenge) {
      // Meta strictly requires plain string challenge response with 200 OK
      return res.status(HttpStatus.OK).send(result.challenge);
    }

    return res.status(HttpStatus.FORBIDDEN).send('Forbidden: Invalid verification token');
  }

  /**
   * WhatsApp Webhook Event Receiver (POST)
   * Verifies signature, logs raw payload, responds 200 OK immediately, and queues async job
   */
  @Post('whatsapp')
  async handleWhatsAppWebhook(
    @Req() req: RequestWithRawBody,
    @Res() res: Response,
  ) {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const rawBody = req.rawBody || JSON.stringify(req.body);

    // 1. Verify HMAC Signature
    const isSignatureValid = this.webhooksService.verifySignature(
      WebhookPlatform.WHATSAPP,
      rawBody,
      signature,
    );

    if (!isSignatureValid) {
      this.logger.warn('[WhatsApp] Rejected webhook payload: Invalid HMAC signature');
      return res.status(HttpStatus.UNAUTHORIZED).send('Invalid webhook signature');
    }

    // 2. Log raw payload immediately for zero data loss
    const log = await this.webhooksService.logRawPayload(
      WebhookPlatform.WHATSAPP,
      req.body,
      req.headers as Record<string, any>,
    );

    // 3. Respond HTTP 200 immediately to Meta before business logic runs
    res.status(HttpStatus.OK).send('EVENT_RECEIVED');

    // 4. Hand off to asynchronous processing queue
    this.webhooksQueueService.enqueue({
      logId: log.id,
      platform: WebhookPlatform.WHATSAPP,
      payload: req.body,
      receivedAt: new Date(),
    });
  }

  // ---------------------------------------------------------------------------
  // INSTAGRAM WEBHOOKS (MESSAGES & COMMENTS)
  // ---------------------------------------------------------------------------

  /**
   * Instagram Webhook Verification Handshake (GET)
   * Meta sends hub.mode, hub.verify_token, hub.challenge
   */
  @Get('instagram')
  verifyInstagramWebhook(@Query() query: WebhookVerifyDto, @Res() res: Response) {
    const result = this.webhooksService.verifyHandshake(WebhookPlatform.INSTAGRAM, query);

    if (result.isValid && result.challenge) {
      // Meta strictly requires plain string challenge response with 200 OK
      return res.status(HttpStatus.OK).send(result.challenge);
    }

    return res.status(HttpStatus.FORBIDDEN).send('Forbidden: Invalid verification token');
  }

  /**
   * Instagram Webhook Event Receiver (POST)
   * Covers BOTH "messages" (DMs) and "comments" (Posts/Reels)
   */
  @Post('instagram')
  async handleInstagramWebhook(
    @Req() req: RequestWithRawBody,
    @Res() res: Response,
  ) {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const rawBody = req.rawBody || JSON.stringify(req.body);

    // 1. Verify HMAC Signature
    const isSignatureValid = this.webhooksService.verifySignature(
      WebhookPlatform.INSTAGRAM,
      rawBody,
      signature,
    );

    if (!isSignatureValid) {
      this.logger.warn('[Instagram] Rejected webhook payload: Invalid HMAC signature');
      return res.status(HttpStatus.UNAUTHORIZED).send('Invalid webhook signature');
    }

    // 2. Log raw payload immediately for zero data loss
    const log = await this.webhooksService.logRawPayload(
      WebhookPlatform.INSTAGRAM,
      req.body,
      req.headers as Record<string, any>,
    );

    // 3. Respond HTTP 200 immediately to Meta before business logic runs
    res.status(HttpStatus.OK).send('EVENT_RECEIVED');

    // 4. Hand off to asynchronous processing queue
    this.webhooksQueueService.enqueue({
      logId: log.id,
      platform: WebhookPlatform.INSTAGRAM,
      payload: req.body,
      receivedAt: new Date(),
    });
  }

  // ---------------------------------------------------------------------------
  // AUDIT & LOGS (ADMIN ONLY)
  // ---------------------------------------------------------------------------

  /**
   * View recent webhook ingestion logs for diagnostics and debugging
   */
  @Get('logs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getWebhookLogs(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return this.webhooksService.getRecentLogs(parsedLimit);
  }
}
