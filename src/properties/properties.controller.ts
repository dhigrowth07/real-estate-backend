import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  ParseFilePipe,
  MaxFileSizeValidator,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { PropertiesService } from './properties.service';
import { StorageService } from '../common/storage/storage.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyFilterDto } from './dto/property-filter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('properties')
export class PropertiesController {
  constructor(
    private readonly propertiesService: PropertiesService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Upload property images (S3 / Local Storage)
   */
  @Post('upload-images')
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadImages(
    @UploadedFiles(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 })],
        fileIsRequired: true,
      }),
    )
    files: Express.Multer.File[],
  ) {
    const uploaded = await this.storageService.uploadFiles(files, 'properties');
    return {
      files: uploaded,
      urls: uploaded.map((f) => f.url),
    };
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreatePropertyDto) {
    return this.propertiesService.create(user, dto);
  }

  @Get()
  findAll(@CurrentUser() user: any, @Query() filter: PropertyFilterDto) {
    return this.propertiesService.findAll(user, filter);
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.propertiesService.findOne(id, user);
  }

  @Patch(':id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdatePropertyDto) {
    return this.propertiesService.update(id, dto, user);
  }

  @Delete(':id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.propertiesService.remove(id, user);
  }

  @Post(':id/restore')
  restore(@CurrentUser() user: any, @Param('id') id: string) {
    return this.propertiesService.restore(id, user);
  }
}
