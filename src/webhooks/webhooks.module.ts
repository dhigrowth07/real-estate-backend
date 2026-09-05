import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksQueueService } from './webhooks-queue.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhooksQueueService],
  exports: [WebhooksService, WebhooksQueueService],
})
export class WebhooksModule {}
