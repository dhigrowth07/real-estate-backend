import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { UpdateMatchStatusDto } from './dto/update-match-status.dto';
import { MatchFilterDto } from './dto/match-filter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('matches')
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get()
  findAll(@Query() filter: MatchFilterDto) {
    return this.matchesService.findAll(filter);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.matchesService.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateMatchStatusDto) {
    return this.matchesService.updateStatus(id, dto);
  }

  @Post('recalculate/lead/:leadId')
  recalculateForLead(@Param('leadId') leadId: string) {
    return this.matchesService.generateMatchesForLead(leadId);
  }

  @Post('recalculate/property/:propertyId')
  recalculateForProperty(@Param('propertyId') propertyId: string) {
    return this.matchesService.generateMatchesForProperty(propertyId);
  }
}
