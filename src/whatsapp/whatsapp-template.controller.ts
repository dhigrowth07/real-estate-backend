import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WhatsAppTemplateService } from './whatsapp-template.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsAppTemplateController {
  constructor(
    private readonly whatsAppTemplateService: WhatsAppTemplateService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * List all message templates in registry
   */
  @Get('templates')
  async listTemplates() {
    return this.prisma.template.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Send property brochure template for a specific lead
   */
  @Post('send-property-details/:leadId')
  @HttpCode(HttpStatus.OK)
  async sendPropertyDetails(@Param('leadId') leadId: string) {
    return this.whatsAppTemplateService.sendPropertyDetailsTemplate(leadId);
  }
}
