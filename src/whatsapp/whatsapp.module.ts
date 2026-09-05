import { Module } from '@nestjs/common';
import { WhatsAppTemplateService } from './whatsapp-template.service';
import { WhatsAppTemplateController } from './whatsapp-template.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [WhatsAppTemplateController],
  providers: [WhatsAppTemplateService],
  exports: [WhatsAppTemplateService],
})
export class WhatsAppModule {}
