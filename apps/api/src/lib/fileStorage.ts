import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

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

export const fileStorage: FileStorage = new LocalVolumeStorage();
