import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { AgentVisibilityMode } from '@prisma/client';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getSettings() {
    return this.prisma.agencySetting.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        agentVisibilityMode: AgentVisibilityMode.ALL,
      },
      update: {},
    });
  }

  async updateSettings(dto: UpdateSettingsDto) {
    return this.prisma.agencySetting.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        agentVisibilityMode: dto.agentVisibilityMode,
      },
      update: {
        agentVisibilityMode: dto.agentVisibilityMode,
      },
    });
  }

  async getVisibilityMode(): Promise<AgentVisibilityMode> {
    const settings = await this.getSettings();
    return settings.agentVisibilityMode;
  }
}
