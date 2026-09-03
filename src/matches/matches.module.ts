import { Module, forwardRef } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { MatchesController } from './matches.controller';
import { MatchingEngineService } from './matching-engine.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [forwardRef(() => NotificationsModule)],
  controllers: [MatchesController],
  providers: [MatchesService, MatchingEngineService],
  exports: [MatchesService, MatchingEngineService],
})
export class MatchesModule {}
