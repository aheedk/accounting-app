import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

// Takes a copy of the database and proves the copy can be restored.
//
//   npm run db:backup            dump the database to backups/accounting-<time>.dump
//   npm run db:backup:verify     restore the newest dump into a throwaway Postgres
//                                and count the rows in every table
//   npm run db:backup:verify -- --compare
//                                the same, and check the counts against the live database
//
// The database is BACKUP_DATABASE_URL if set, otherwise DATABASE_URL. Nothing is
// ever written to it: the dump only reads, and the restore goes into a container
// that is removed afterwards. Docker has to be running; pg_dump and pg_restore
// come from the Postgres image, so nothing else needs installing.
// Guide: docs/guides/backups.md.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.resolve(__dirname, '../backups');
// The tools must be at least as new as the server they read from.
const IMAGE = process.env.BACKUP_PG_IMAGE ?? 'postgres:17-alpine';

const COUNT_ROWS = `
  SELECT table_name,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint AS n
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
   ORDER BY table_name`;

function sourceUrl(): string {
  const url = process.env.BACKUP_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Set BACKUP_DATABASE_URL (or DATABASE_URL) to the database to back up.');
  return url;
}

/** Inside a container "localhost" is the container, so a local database is reached through the host. */
function urlFromContainer(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') parsed.hostname = 'host.docker.internal';
  return parsed.toString();
}

function describe(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}`;
}

function docker(args: string[], input?: string): { ok: boolean; out: string; err: string } {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...(input !== undefined ? { input } : {}) });
  return { ok: result.status === 0, out: result.stdout ?? '', err: result.stderr ?? '' };
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

async function dump(): Promise<string> {
  const url = sourceUrl();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `accounting-${stamp()}.dump`);
  console.log(`Dumping ${describe(url)} ...`);
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(file);
    const child = spawn('docker', [
      'run', '--rm', '--add-host=host.docker.internal:host-gateway',
      '-e', `PGURL=${urlFromContainer(url)}`, IMAGE,
      'sh', '-c', 'pg_dump --format=custom --no-owner --no-acl "$PGURL"',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stdout.pipe(out);
    child.stderr.on('data', chunk => { err += String(chunk); });
    child.on('error', reject);
    child.on('close', code => {
      out.close();
      if (code === 0) resolve();
      else { fs.rmSync(file, { force: true }); reject(new Error(`pg_dump failed:\n${err.trim()}`)); }
    });
  });
  const size = fs.statSync(file).size;
  if (size === 0) { fs.rmSync(file, { force: true }); throw new Error('pg_dump wrote an empty file.'); }
  console.log(`Wrote ${path.relative(process.cwd(), file)} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  return file;
}

function newestDump(): string {
  const files = fs.existsSync(BACKUP_DIR)
    ? fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.dump')).sort()
    : [];
  const newest = files[files.length - 1];
  if (!newest) throw new Error('No dump in backups/. Run "npm run db:backup" first.');
  return path.join(BACKUP_DIR, newest);
}

function parseCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of text.split('\n')) {
    const [table, n] = line.trim().split('|');
    if (table && n !== undefined) counts.set(table, Number(n));
  }
  return counts;
}

async function verify(file: string, compare: boolean): Promise<void> {
  const name = `accounting-restore-check-${Date.now()}`;
  console.log(`Restoring ${path.relative(process.cwd(), file)} into a throwaway Postgres ...`);
  const started = docker(['run', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD=restore-check', IMAGE]);
  if (!started.ok) throw new Error(`Could not start Postgres:\n${started.err.trim()}`);
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i += 1) {
      // The image starts Postgres twice (once to initialise); a query proves it is the real one.
      ready = docker(['exec', name, 'psql', '-U', 'postgres', '-At', '-c', 'select 1']).out.trim() === '1';
      if (!ready) await new Promise(r => setTimeout(r, 1000));
    }
    if (!ready) throw new Error('Postgres did not come up in a minute.');

    const copied = docker(['cp', file, `${name}:/tmp/restore.dump`]);
    if (!copied.ok) throw new Error(`Could not copy the dump in:\n${copied.err.trim()}`);
    const restored = docker(['exec', name, 'pg_restore', '--no-owner', '--no-acl', '--exit-on-error', '-U', 'postgres', '-d', 'postgres', '/tmp/restore.dump']);
    if (!restored.ok) throw new Error(`pg_restore failed:\n${restored.err.trim()}`);

    const counted = docker(['exec', name, 'psql', '-U', 'postgres', '-At', '-c', COUNT_ROWS]);
    if (!counted.ok) throw new Error(`Could not count rows:\n${counted.err.trim()}`);
    const restoredCounts = parseCounts(counted.out);
    const rows = [...restoredCounts.values()].reduce((sum, n) => sum + n, 0);
    if (restoredCounts.size === 0) throw new Error('The restored database has no tables.');
    console.log(`Restored ${restoredCounts.size} tables, ${rows} rows.`);
    const biggest = [...restoredCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    for (const [table, n] of biggest) console.log(`  ${String(n).padStart(9)}  ${table}`);

    if (compare) {
      const pool = new Pool({ connectionString: sourceUrl() });
      try {
        const live = await pool.query<{ table_name: string; n: string }>(COUNT_ROWS);
        const differences: string[] = [];
        for (const row of live.rows) {
          const have = restoredCounts.get(row.table_name);
          if (have === undefined) differences.push(`${row.table_name}: missing from the dump`);
          else if (have !== Number(row.n)) differences.push(`${row.table_name}: ${have} in the dump, ${row.n} live`);
        }
        if (differences.length === 0) console.log('Every table has the same number of rows as the live database.');
        else {
          // Not a failure on its own: the live database keeps moving after the dump is taken.
          console.log(`${differences.length} table(s) differ from the live database (expected if it was used since the dump):`);
          for (const line of differences) console.log(`  ${line}`);
        }
      } finally {
        await pool.end();
      }
    }
    console.log('Restore check passed.');
  } finally {
    docker(['rm', '-f', name]);
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'dump') {
    await dump();
  } else if (command === 'verify') {
    const file = rest.find(arg => !arg.startsWith('--'));
    await verify(file ? path.resolve(file) : newestDump(), rest.includes('--compare'));
  } else {
    console.log('Usage: tsx bin/backup.ts dump | verify [file] [--compare]');
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
