import { Module, forwardRef } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { MergeLeadsService } from './merge-leads.service';
import { MatchesModule } from '../matches/matches.module';

@Module({
  imports: [forwardRef(() => MatchesModule)],
  controllers: [LeadsController],
  providers: [LeadsService, MergeLeadsService],
  exports: [LeadsService, MergeLeadsService],
})
export class LeadsModule {}
