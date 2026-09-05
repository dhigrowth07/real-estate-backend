import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreatePostMappingDto {
  /**
   * Instagram Post/Reel URL (e.g. https://www.instagram.com/p/C_12345/ or https://www.instagram.com/reel/C_12345/)
   * OR raw Meta Instagram Media ID / Shortcode
   */
  @IsNotEmpty({ message: 'Instagram media ID or post URL is required' })
  @IsString()
  instagramMediaIdOrUrl: string;

  /**
   * UUID of the real estate property in the catalog
   */
  @IsNotEmpty({ message: 'Property ID is required' })
  @IsUUID('4', { message: 'Property ID must be a valid UUID' })
  propertyId: string;
}
