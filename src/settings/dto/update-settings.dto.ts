import { IsEnum, IsNotEmpty } from 'class-validator';
import { AgentVisibilityMode } from '@prisma/client';

export class UpdateSettingsDto {
  @IsEnum(AgentVisibilityMode, {
    message: 'agentVisibilityMode must be either ASSIGNED_ONLY or ALL',
  })
  @IsNotEmpty()
  agentVisibilityMode: AgentVisibilityMode;
}
