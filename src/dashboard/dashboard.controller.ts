import { Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Get full dashboard overview
   */
  @Get()
  getDashboardSummary(@CurrentUser() user: any) {
    return this.dashboardService.getDashboardSummary(user);
  }

  /**
   * Get stats and distribution breakdowns
   */
  @Get('stats')
  getStats(@CurrentUser() user: any) {
    return this.dashboardService.getStats(user);
  }

  /**
   * Get top 5 recent leads
   */
  @Get('recent-leads')
  getRecentLeads(@CurrentUser() user: any) {
    return this.dashboardService.getRecentLeads(user);
  }

  /**
   * Get aging inventory (30+ days without >= 50% match)
   */
  @Get('aging-inventory')
  getAgingInventory(@CurrentUser() user: any) {
    return this.dashboardService.getAgingInventory(user);
  }
}
