import { Module, forwardRef } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { MergeLeadsService } from './merge-leads.service';
import { LeadQualificationService } from './lead-qualification.service';
import { MatchesModule } from '../matches/matches.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { PropertiesModule } from '../properties/properties.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    forwardRef(() => MatchesModule),
    forwardRef(() => NotificationsModule),
    WhatsAppModule,
    PropertiesModule,
  ],
  controllers: [LeadsController],
  providers: [LeadsService, MergeLeadsService, LeadQualificationService],
  exports: [LeadsService, MergeLeadsService, LeadQualificationService],
})
export class LeadsModule {}
