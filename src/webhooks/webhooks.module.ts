import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksQueueService } from './webhooks-queue.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';

import { InstagramCommentsHandler } from './handlers/instagram-comments.handler';
import { InstagramMessagesHandler } from './handlers/instagram-messages.handler';
import { PhoneModule } from '../common/phone/phone.module';

@Module({
  imports: [PrismaModule, ConfigModule, PhoneModule],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhooksQueueService,
    InstagramCommentsHandler,
    InstagramMessagesHandler,
  ],
  exports: [
    WebhooksService,
    WebhooksQueueService,
    InstagramCommentsHandler,
    InstagramMessagesHandler,
  ],
})
export class WebhooksModule {}
