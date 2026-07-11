import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export type StoredFile = {
  storage_path: string;
  byte_size: number;
  sha256: string;
};

export interface FileStorage {
  store(buffer: Buffer, mime_type: string): Promise<StoredFile>;
  read(storage_path: string): Promise<Buffer>;
  exists(storage_path: string): Promise<boolean>;
}

function rootDir(): string {
  return process.env['FILE_STORAGE_DIR'] ?? './.local-data/files';
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'text/csv': '.csv',
    'text/plain': '.txt',
  };
  return map[mime] ?? '.bin';
}

export class LocalVolumeStorage implements FileStorage {
  async store(buffer: Buffer, mime_type: string): Promise<StoredFile> {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const ext = extFromMime(mime_type);
    const storage_path = `${sha256.slice(0, 2)}/${sha256.slice(2)}${ext}`;
    const full = path.join(rootDir(), storage_path);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, buffer);
    return { storage_path, byte_size: buffer.length, sha256 };
  }

  async read(storage_path: string): Promise<Buffer> {
    return readFile(path.join(rootDir(), storage_path));
  }

  async exists(storage_path: string): Promise<boolean> {
    try {
      await stat(path.join(rootDir(), storage_path));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * S3-compatible object storage (Cloudflare R2, AWS S3, MinIO, …). Activated by
 * setting S3_BUCKET (+ S3_ENDPOINT for R2, AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY via the SDK's default credential chain). Removes the
 * Railway-volume size cap and survives redeploys.
 */
export class S3Storage implements FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(opts: { bucket: string; endpoint?: string | undefined }) {
    this.bucket = opts.bucket;
    this.client = new S3Client({
      region: process.env['AWS_REGION'] ?? 'auto',
      // R2 and most S3-compatibles need path-style addressing on a custom endpoint.
      ...(opts.endpoint ? { endpoint: opts.endpoint, forcePathStyle: true } : {}),
    });
  }

  async store(buffer: Buffer, mime_type: string): Promise<StoredFile> {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const ext = extFromMime(mime_type);
    const storage_path = `${sha256.slice(0, 2)}/${sha256.slice(2)}${ext}`;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: storage_path,
      Body: buffer,
      ContentType: mime_type,
    }));
    return { storage_path, byte_size: buffer.length, sha256 };
  }

  async read(storage_path: string): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storage_path }));
    if (!r.Body) throw new Error(`empty S3 body for ${storage_path}`);
    return Buffer.from(await r.Body.transformToByteArray());
  }

  async exists(storage_path: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: storage_path }));
      return true;
    } catch {
      return false;
    }
  }
}

// Env-gated swap: dormant until S3_BUCKET is set (no new env required to run).
export const fileStorage: FileStorage = process.env['S3_BUCKET']
  ? new S3Storage({ bucket: process.env['S3_BUCKET'], endpoint: process.env['S3_ENDPOINT'] })
  : new LocalVolumeStorage();
