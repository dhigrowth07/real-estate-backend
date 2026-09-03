import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface UploadedFileResponse {
  url: string;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client | null = null;
  private bucketName: string | null = null;
  private region: string = 'us-east-1';

  constructor(private configService: ConfigService) {
    this.bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME') || null;
    this.region = this.configService.get<string>('AWS_REGION') || 'us-east-1';

    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    const endpoint = this.configService.get<string>('AWS_S3_ENDPOINT');

    if (this.bucketName && accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        region: this.region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        endpoint: endpoint || undefined,
        forcePathStyle: !!endpoint, // Useful if using MinIO / LocalStack
      });
      this.logger.log(`StorageService initialized with AWS S3 (Bucket: ${this.bucketName})`);
    } else {
      this.logger.log(
        'StorageService running in Local Storage fallback mode (no AWS S3 credentials found)',
      );
    }
  }

  /**
   * Validate and upload a single file to AWS S3 (or local fallback)
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'properties',
  ): Promise<UploadedFileResponse> {
    if (!file) {
      throw new BadRequestException('No file provided for upload.');
    }

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/jpg'];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type "${file.mimetype}". Only JPEG, PNG, WEBP, and GIF images are allowed.`,
      );
    }

    const maxSizeBytes = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSizeBytes) {
      throw new BadRequestException('File size exceeds the 5MB limit.');
    }

    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const uniqueKey = `${folder}/${crypto.randomBytes(16).toString('hex')}${ext}`;

    if (this.s3Client && this.bucketName) {
      return this.uploadToS3(file, uniqueKey);
    } else {
      return this.uploadToLocal(file, uniqueKey);
    }
  }

  /**
   * Upload multiple files
   */
  async uploadFiles(
    files: Express.Multer.File[],
    folder: string = 'properties',
  ): Promise<UploadedFileResponse[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided.');
    }

    return Promise.all(files.map((file) => this.uploadFile(file, folder)));
  }

  private async uploadToS3(file: Express.Multer.File, key: string): Promise<UploadedFileResponse> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName!,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      await this.s3Client!.send(command);

      const customDomain = this.configService.get<string>('AWS_S3_CUSTOM_DOMAIN');
      const url = customDomain
        ? `${customDomain}/${key}`
        : `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;

      return {
        url,
        filename: path.basename(key),
        originalName: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
      };
    } catch (err) {
      this.logger.error('Failed to upload file to AWS S3', err);
      throw new BadRequestException(`S3 upload error: ${err.message}`);
    }
  }

  private async uploadToLocal(
    file: Express.Multer.File,
    key: string,
  ): Promise<UploadedFileResponse> {
    const uploadDir = path.join(process.cwd(), 'uploads', path.dirname(key));
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filePath = path.join(process.cwd(), 'uploads', key);
    fs.writeFileSync(filePath, file.buffer);

    const relativeUrl = `/uploads/${key.replace(/\\/g, '/')}`;

    return {
      url: relativeUrl,
      filename: path.basename(key),
      originalName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    };
  }
}
