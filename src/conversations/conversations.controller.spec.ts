import { Test, TestingModule } from '@nestjs/testing';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ChannelType } from '@prisma/client';

describe('ConversationsController', () => {
  let controller: ConversationsController;
  let service: ConversationsService;

  const mockService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    sendMessage: jest.fn(),
    markAsRead: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [{ provide: ConversationsService, useValue: mockService }],
    }).compile();

    controller = module.get<ConversationsController>(ConversationsController);
    service = module.get<ConversationsService>(ConversationsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('findAll should call service.findAll', async () => {
    mockService.findAll.mockResolvedValue([]);
    await controller.findAll(ChannelType.WHATSAPP, 'search');
    expect(mockService.findAll).toHaveBeenCalledWith(ChannelType.WHATSAPP, 'search');
  });

  it('findOne should call service.findOne', async () => {
    mockService.findOne.mockResolvedValue({ id: 'conv-1' });
    const res = await controller.findOne('conv-1');
    expect(res).toEqual({ id: 'conv-1' });
  });

  it('sendMessage should call service.sendMessage', async () => {
    mockService.sendMessage.mockResolvedValue({ id: 'msg-1' });
    const res = await controller.sendMessage('conv-1', { id: 'user-1' }, { rawText: 'Hello' });
    expect(mockService.sendMessage).toHaveBeenCalledWith('conv-1', 'user-1', { rawText: 'Hello' });
    expect(res).toEqual({ id: 'msg-1' });
  });

  it('markAsRead should call service.markAsRead', async () => {
    mockService.markAsRead.mockResolvedValue({ updated: 1 });
    const res = await controller.markAsRead('conv-1');
    expect(mockService.markAsRead).toHaveBeenCalledWith('conv-1');
    expect(res).toEqual({ updated: 1 });
  });
});
