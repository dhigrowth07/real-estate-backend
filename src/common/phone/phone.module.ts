import { Module, Global } from '@nestjs/common';
import { PhoneExtractionService } from './phone-extraction.service';
import { ConfigModule } from '@nestjs/config';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [PhoneExtractionService],
  exports: [PhoneExtractionService],
})
export class PhoneModule {}
