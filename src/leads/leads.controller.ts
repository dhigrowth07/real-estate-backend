import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadFilterDto } from './dto/lead-filter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateLeadDto) {
    return this.leadsService.create(user, dto);
  }

  @Get()
  findAll(@CurrentUser() user: any, @Query() filter: LeadFilterDto) {
    return this.leadsService.findAll(user, filter);
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.leadsService.findOne(id, user);
  }

  @Patch(':id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.update(id, dto, user);
  }

  @Delete(':id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.leadsService.remove(id, user);
  }

  @Post(':id/restore')
  restore(@CurrentUser() user: any, @Param('id') id: string) {
    return this.leadsService.restore(id, user);
  }
}
