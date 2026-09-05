import { Test, TestingModule } from '@nestjs/testing';
import { PostMappingsController } from './post-mappings.controller';
import { PostMappingsService } from './post-mappings.service';

describe('PostMappingsController', () => {
  let controller: PostMappingsController;
  let service: PostMappingsService;

  const mockService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PostMappingsController],
      providers: [{ provide: PostMappingsService, useValue: mockService }],
    }).compile();

    controller = module.get<PostMappingsController>(PostMappingsController);
    service = module.get<PostMappingsService>(PostMappingsService);
  });

  it('should call service.create on POST', async () => {
    mockService.create.mockResolvedValue({ id: 'map-1' });
    const dto = { instagramMediaIdOrUrl: 'https://instagram.com/p/DF123', propertyId: 'prop-1' };
    const result = await controller.create(dto);
    expect(mockService.create).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ id: 'map-1' });
  });

  it('should call service.findAll on GET', async () => {
    mockService.findAll.mockResolvedValue({ mappings: [], total: 0 });
    const filter = { page: 1, limit: 10 };
    const result = await controller.findAll(filter);
    expect(mockService.findAll).toHaveBeenCalledWith(filter);
    expect(result).toEqual({ mappings: [], total: 0 });
  });

  it('should call service.findOne on GET :id', async () => {
    mockService.findOne.mockResolvedValue({ id: 'map-1' });
    const result = await controller.findOne('map-1');
    expect(mockService.findOne).toHaveBeenCalledWith('map-1');
    expect(result).toEqual({ id: 'map-1' });
  });

  it('should call service.remove on DELETE :id', async () => {
    mockService.remove.mockResolvedValue({ success: true });
    const result = await controller.remove('map-1');
    expect(mockService.remove).toHaveBeenCalledWith('map-1');
    expect(result).toEqual({ success: true });
  });
});
