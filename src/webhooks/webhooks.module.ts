import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksQueueService } from './webhooks-queue.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';

import { InstagramCommentsHandler } from './handlers/instagram-comments.handler';
import { InstagramMessagesHandler } from './handlers/instagram-messages.handler';
import { WhatsAppMessagesHandler } from './handlers/whatsapp-messages.handler';
import { PhoneModule } from '../common/phone/phone.module';
import { MatchesModule } from '../matches/matches.module';
import { LeadsModule } from '../leads/leads.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    PhoneModule,
    MatchesModule,
    LeadsModule,
    WhatsAppModule,
  ],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhooksQueueService,
    InstagramCommentsHandler,
    InstagramMessagesHandler,
    WhatsAppMessagesHandler,
  ],
  exports: [
    WebhooksService,
    WebhooksQueueService,
    InstagramCommentsHandler,
    InstagramMessagesHandler,
    WhatsAppMessagesHandler,
  ],
})
export class WebhooksModule {}
