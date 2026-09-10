import { Module, forwardRef } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { BudgetBandService } from './budget-band.service';
import { PropertiesController } from './properties.controller';
import { MatchesModule } from '../matches/matches.module';

@Module({
  imports: [forwardRef(() => MatchesModule)],
  controllers: [PropertiesController],
  providers: [PropertiesService, BudgetBandService],
  exports: [PropertiesService, BudgetBandService],
})
export class PropertiesModule {}
