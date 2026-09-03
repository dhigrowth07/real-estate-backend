import { Module, forwardRef } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { MatchesModule } from '../matches/matches.module';

@Module({
  imports: [forwardRef(() => MatchesModule)],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
