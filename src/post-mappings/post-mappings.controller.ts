import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PostMappingsService } from './post-mappings.service';
import { CreatePostMappingDto } from './dto/create-post-mapping.dto';
import { PostMappingFilterDto } from './dto/post-mapping-filter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('post-mappings')
@UseGuards(JwtAuthGuard)
export class PostMappingsController {
  constructor(private readonly postMappingsService: PostMappingsService) {}

  /**
   * Create a new mapping between an Instagram Post/Reel and a catalog Property
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreatePostMappingDto) {
    return this.postMappingsService.create(dto);
  }

  /**
   * List all post-to-property mappings with pagination and search
   */
  @Get()
  findAll(@Query() filter: PostMappingFilterDto) {
    return this.postMappingsService.findAll(filter);
  }

  /**
   * Get details of a single post-to-property mapping
   */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.postMappingsService.findOne(id);
  }

  /**
   * Delete a post-to-property mapping
   */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.postMappingsService.remove(id);
  }
}
