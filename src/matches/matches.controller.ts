import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { UpdateMatchStatusDto } from './dto/update-match-status.dto';
import { MatchFilterDto } from './dto/match-filter.dto';
import { UpdateMatchingWeightsDto } from './dto/update-matching-weights.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('matches')
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get('config')
  getMatchingWeights() {
    return this.matchesService.getActiveWeights();
  }

  @Roles(UserRole.ADMIN)
  @Patch('config')
  updateMatchingWeights(@Body() dto: UpdateMatchingWeightsDto) {
    return this.matchesService.updateWeights(dto);
  }

  @Get()
  findAll(@CurrentUser() user: any, @Query() filter: MatchFilterDto) {
    return this.matchesService.findAll(user, filter);
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.matchesService.findOne(id, user);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateMatchStatusDto,
  ) {
    return this.matchesService.updateStatus(id, dto, user);
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
