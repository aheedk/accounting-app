import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalVolumeStorage } from '../../src/lib/fileStorage.js';

let tempRoot: string;

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'fileStorage-test-'));
  process.env['FILE_STORAGE_DIR'] = tempRoot;
});
afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe('LocalVolumeStorage', () => {
  it('store + read round-trips a buffer', async () => {
    const s = new LocalVolumeStorage();
    const buf = Buffer.from('hello receipts world');
    const stored = await s.store(buf, 'text/plain');
    expect(stored.byte_size).toBe(buf.length);
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.storage_path).toMatch(/\.txt$/);

    const back = await s.read(stored.storage_path);
    expect(back.equals(buf)).toBe(true);
    expect(await s.exists(stored.storage_path)).toBe(true);
  });

  it('store dedups by content hash (same content -> same storage_path)', async () => {
    const s = new LocalVolumeStorage();
    const a = await s.store(Buffer.from('identical bytes'), 'text/plain');
    const b = await s.store(Buffer.from('identical bytes'), 'text/plain');
    expect(b.storage_path).toBe(a.storage_path);
    expect(b.sha256).toBe(a.sha256);
  });

  it('different content -> different storage_path', async () => {
    const s = new LocalVolumeStorage();
    const a = await s.store(Buffer.from('one'), 'text/plain');
    const b = await s.store(Buffer.from('two'), 'text/plain');
    expect(b.storage_path).not.toBe(a.storage_path);
  });
});
