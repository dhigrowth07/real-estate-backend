import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InstagramProfileService } from './instagram-profile.service';

describe('InstagramProfileService', () => {
  let service: InstagramProfileService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'INSTAGRAM_API_TOKEN') return 'test_meta_token_123';
      if (key === 'INSTAGRAM_PROFILE_CACHE_TTL_HOURS') return 24;
      return null;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstagramProfileService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<InstagramProfileService>(InstagramProfileService);
    service.clearCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return null if instagramUserId is empty or whitespace', async () => {
    expect(await service.getProfile('')).toBeNull();
    expect(await service.getProfile('   ')).toBeNull();
  });

  it('should return null if no API token is configured', async () => {
    mockConfigService.get.mockReturnValue(null);
    const result = await service.getProfile('igsid_123');
    expect(result).toBeNull();
  });

  it('should successfully fetch profile from Graph API and cache the result', async () => {
    const mockApiResponse = {
      name: 'Rohan Sharma',
      username: 'rohan_realestate',
      profile_pic: 'https://lookaside.fbsbx.com/ig_pic.jpg',
    };

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    } as any);

    const profile = await service.getProfile('igsid_456');

    expect(profile).toEqual({
      name: 'Rohan Sharma',
      username: 'rohan_realestate',
      profilePic: 'https://lookaside.fbsbx.com/ig_pic.jpg',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call should hit the cache without calling fetch again
    const cachedProfile = await service.getProfile('igsid_456');
    expect(cachedProfile).toEqual(profile);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should fallback to username or name if some fields are missing', async () => {
    const mockApiResponse = {
      username: 'only_username_user',
    };

    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    } as any);

    const profile = await service.getProfile('igsid_789');

    expect(profile).toEqual({
      name: null,
      username: 'only_username_user',
      profilePic: null,
    });
  });

  it('should try fallback endpoint if first endpoint returns 400 error', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Unsupported get request',
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'Fallback Name', username: 'fb_user' }),
      } as any);

    const profile = await service.getProfile('igsid_fallback');

    expect(profile).toEqual({
      name: 'Fallback Name',
      username: 'fb_user',
      profilePic: null,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('should return null when all Graph API endpoints fail', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not found',
    } as any);

    const profile = await service.getProfile('igsid_nonexistent');
    expect(profile).toBeNull();
  });
});
