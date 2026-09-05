import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { WebhookPlatform, WebhookStatus } from '@prisma/client';
import * as crypto from 'crypto';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let prismaService: PrismaService;
  let configService: ConfigService;

  const mockPrismaService = {
    webhookLog: {
      create: jest.fn().mockImplementation((args) =>
        Promise.resolve({
          id: 'test-log-uuid',
          ...args.data,
          createdAt: new Date(),
        }),
      ),
      update: jest.fn().mockImplementation((args) =>
        Promise.resolve({
          id: args.where.id,
          ...args.data,
        }),
      ),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'META_VERIFY_TOKEN') return 'valid_token_123';
      if (key === 'META_APP_SECRET') return 'secret_key_456';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
    prismaService = module.get<PrismaService>(PrismaService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('verifyHandshake', () => {
    it('should return isValid: true and challenge for matching verify_token', () => {
      const query = {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'valid_token_123',
        'hub.challenge': '1158201444',
      };

      const result = service.verifyHandshake(WebhookPlatform.WHATSAPP, query);
      expect(result.isValid).toBe(true);
      expect(result.challenge).toBe('1158201444');
    });

    it('should reject handshake when token does not match', () => {
      const query = {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong_token',
        'hub.challenge': '1158201444',
      };

      const result = service.verifyHandshake(WebhookPlatform.INSTAGRAM, query);
      expect(result.isValid).toBe(false);
      expect(result.challenge).toBeUndefined();
    });

    it('should reject handshake when hub.mode is not subscribe', () => {
      const query = {
        'hub.mode': 'unsubscribe',
        'hub.verify_token': 'valid_token_123',
        'hub.challenge': '1158201444',
      };

      const result = service.verifyHandshake(WebhookPlatform.WHATSAPP, query);
      expect(result.isValid).toBe(false);
    });
  });

  describe('verifySignature', () => {
    const payload = JSON.stringify({ object: 'whatsapp_business_account' });
    const secret = 'secret_key_456';
    const validSignature = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;

    it('should validate matching HMAC-SHA256 signature', () => {
      const isValid = service.verifySignature(
        WebhookPlatform.WHATSAPP,
        payload,
        validSignature,
      );
      expect(isValid).toBe(true);
    });

    it('should reject invalid or tampered HMAC-SHA256 signature', () => {
      const isValid = service.verifySignature(
        WebhookPlatform.WHATSAPP,
        payload,
        'sha256=invalidhex00000000000000000000000000000000000000000000000000000000',
      );
      expect(isValid).toBe(false);
    });

    it('should reject when signature header is missing', () => {
      const isValid = service.verifySignature(
        WebhookPlatform.INSTAGRAM,
        payload,
        undefined,
      );
      expect(isValid).toBe(false);
    });
  });

  describe('logRawPayload', () => {
    it('should detect comments event for Instagram comment payload and save to db', async () => {
      const instagramCommentPayload = {
        object: 'instagram',
        entry: [
          {
            id: '17841400',
            changes: [
              {
                field: 'comments',
                value: {
                  id: '179001',
                  text: 'What is the price of this 3 BHK?',
                },
              },
            ],
          },
        ],
      };

      const log = await service.logRawPayload(
        WebhookPlatform.INSTAGRAM,
        instagramCommentPayload,
        { 'x-hub-signature-256': 'sha256=abc' },
      );

      expect(log.eventType).toBe('comments');
      expect(log.platform).toBe(WebhookPlatform.INSTAGRAM);
      expect(prismaService.webhookLog.create).toHaveBeenCalled();
    });

    it('should detect messages event for Instagram DM payload and save to db', async () => {
      const instagramDmPayload = {
        object: 'instagram',
        entry: [
          {
            id: '17841400',
            messaging: [
              {
                sender: { id: 'user123' },
                recipient: { id: 'page456' },
                message: { text: 'Hi, I need info on Villa' },
              },
            ],
          },
        ],
      };

      const log = await service.logRawPayload(
        WebhookPlatform.INSTAGRAM,
        instagramDmPayload,
      );

      expect(log.eventType).toBe('messages');
      expect(log.platform).toBe(WebhookPlatform.INSTAGRAM);
    });
  });
});
