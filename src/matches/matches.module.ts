import { Module } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { MatchesController } from './matches.controller';
import { MatchingEngineService } from './matching-engine.service';

@Module({
  controllers: [MatchesController],
  providers: [MatchesService, MatchingEngineService],
  exports: [MatchesService, MatchingEngineService],
})
export class MatchesModule {}
