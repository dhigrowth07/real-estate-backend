import { Module } from '@nestjs/common';
import { PostMappingsController } from './post-mappings.controller';
import { PostMappingsService } from './post-mappings.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PostMappingsController],
  providers: [PostMappingsService],
  exports: [PostMappingsService],
})
export class PostMappingsModule {}
