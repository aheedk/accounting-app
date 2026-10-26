// Copies uploaded files from a folder (a copy of the Railway volume's
// FILE_STORAGE_DIR) into the bucket the API reads them from once S3_BUCKET is
// set (Supabase Storage after the move: docs/plans/2026-10-25-azure-supabase-move.md).
// Each file keeps its path as its key, which is its storage_path in the
// database (lib/fileStorage.ts). Files already in the bucket are skipped, so it
// can be run again after a later copy of the volume.
//
//   S3_BUCKET=… S3_ENDPOINT=… AWS_REGION=… AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… \
//     npm run files:upload -- <folder>
import fs from 'node:fs/promises';
import path from 'node:path';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function main() {
  const folder = process.argv[2];
  const bucket = process.env.S3_BUCKET;
  if (!folder || !bucket) {
    console.error('Usage: S3_BUCKET=… S3_ENDPOINT=… npm run files:upload -- <folder>');
    process.exit(1);
  }
  const endpoint = process.env.S3_ENDPOINT;
  const client = new S3Client({
    region: process.env.AWS_REGION ?? 'auto',
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });

  let copied = 0;
  let skipped = 0;
  for await (const file of walk(folder)) {
    const key = path.relative(folder, file).split(path.sep).join('/');
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      skipped++;
      continue;
    } catch {
      // Not in the bucket yet.
    }
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: await fs.readFile(file) }));
    copied++;
    if (copied % 100 === 0) console.log(`${copied} copied…`);
  }
  console.log(`Done: ${copied} copied, ${skipped} already there.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
