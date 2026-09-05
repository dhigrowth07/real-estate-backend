import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksQueueService } from './webhooks-queue.service';
import { WebhookPlatform, WebhookStatus } from '@prisma/client';
import { HttpStatus } from '@nestjs/common';

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let webhooksService: WebhooksService;
  let webhooksQueueService: WebhooksQueueService;

  const mockWebhooksService = {
    verifyHandshake: jest.fn(),
    verifySignature: jest.fn(),
    logRawPayload: jest.fn().mockResolvedValue({
      id: 'log-123',
      platform: WebhookPlatform.WHATSAPP,
      status: WebhookStatus.RECEIVED,
    }),
    getRecentLogs: jest.fn().mockResolvedValue([]),
  };

  const mockWebhooksQueueService = {
    enqueue: jest.fn(),
  };

  const createMockResponse = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: WebhooksService, useValue: mockWebhooksService },
        { provide: WebhooksQueueService, useValue: mockWebhooksQueueService },
      ],
    }).compile();

    controller = module.get<WebhooksController>(WebhooksController);
    webhooksService = module.get<WebhooksService>(WebhooksService);
    webhooksQueueService = module.get<WebhooksQueueService>(WebhooksQueueService);
  });

  describe('GET /webhooks/whatsapp', () => {
    it('should return 200 with raw challenge on valid handshake', () => {
      mockWebhooksService.verifyHandshake.mockReturnValue({
        isValid: true,
        challenge: '1158201444',
      });
      const res = createMockResponse();

      controller.verifyWhatsAppWebhook(
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'token', 'hub.challenge': '1158201444' },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.send).toHaveBeenCalledWith('1158201444');
    });

    it('should return 403 when handshake verification fails', () => {
      mockWebhooksService.verifyHandshake.mockReturnValue({
        isValid: false,
      });
      const res = createMockResponse();

      controller.verifyWhatsAppWebhook(
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1158201444' },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    });
  });

  describe('POST /webhooks/whatsapp', () => {
    it('should verify signature, log raw payload, respond 200 immediately, and enqueue async job', async () => {
      mockWebhooksService.verifySignature.mockReturnValue(true);
      const res = createMockResponse();
      const req: any = {
        headers: { 'x-hub-signature-256': 'sha256=test' },
        body: { entry: [{ id: '1' }] },
        rawBody: Buffer.from(JSON.stringify({ entry: [{ id: '1' }] })),
      };

      await controller.handleWhatsAppWebhook(req, res);

      expect(mockWebhooksService.verifySignature).toHaveBeenCalledWith(
        WebhookPlatform.WHATSAPP,
        req.rawBody,
        'sha256=test',
      );
      expect(mockWebhooksService.logRawPayload).toHaveBeenCalledWith(
        WebhookPlatform.WHATSAPP,
        req.body,
        req.headers,
      );
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.send).toHaveBeenCalledWith('EVENT_RECEIVED');
      expect(mockWebhooksQueueService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          logId: 'log-123',
          platform: WebhookPlatform.WHATSAPP,
        }),
      );
    });

    it('should return 401 when signature verification fails', async () => {
      mockWebhooksService.verifySignature.mockReturnValue(false);
      const res = createMockResponse();
      const req: any = {
        headers: { 'x-hub-signature-256': 'sha256=invalid' },
        body: {},
      };

      await controller.handleWhatsAppWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(mockWebhooksQueueService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('GET /webhooks/instagram', () => {
    it('should return 200 with challenge for Instagram verification', () => {
      mockWebhooksService.verifyHandshake.mockReturnValue({
        isValid: true,
        challenge: 'insta_challenge_999',
      });
      const res = createMockResponse();

      controller.verifyInstagramWebhook(
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'token', 'hub.challenge': 'insta_challenge_999' },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.send).toHaveBeenCalledWith('insta_challenge_999');
    });
  });

  describe('POST /webhooks/instagram', () => {
    it('should verify signature and log payload for Instagram (both messages and comments)', async () => {
      mockWebhooksService.verifySignature.mockReturnValue(true);
      const res = createMockResponse();
      const req: any = {
        headers: { 'x-hub-signature-256': 'sha256=test' },
        body: { entry: [{ changes: [{ field: 'comments' }] }] },
        rawBody: Buffer.from(JSON.stringify({ entry: [{ changes: [{ field: 'comments' }] }] })),
      };

      await controller.handleInstagramWebhook(req, res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(mockWebhooksService.logRawPayload).toHaveBeenCalledWith(
        WebhookPlatform.INSTAGRAM,
        req.body,
        req.headers,
      );
      expect(mockWebhooksQueueService.enqueue).toHaveBeenCalled();
    });
  });
});
