import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksQueueService } from './webhooks-queue.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';

import { InstagramCommentsHandler } from './handlers/instagram-comments.handler';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhooksQueueService, InstagramCommentsHandler],
  exports: [WebhooksService, WebhooksQueueService, InstagramCommentsHandler],
})
export class WebhooksModule {}
