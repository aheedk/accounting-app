# Backing up the database, and proving a restore works

From the 10-10 meeting, item 43: before real client data arrives on November 1
we have to know the database is backed up and that a restore has been tried.
This guide covers the copy we take ourselves. It does not replace the host's
own backups; see "Still to do" at the end.

Docker has to be running. Nothing else needs installing: `pg_dump` and
`pg_restore` come from the Postgres image.

## Take a backup

```
BACKUP_DATABASE_URL="<the production connection string>" npm run db:backup
```

It writes `backups/accounting-<date>-<time>.dump`. The `backups/` folder is
ignored by git: a dump is client data and must never be committed.

Without `BACKUP_DATABASE_URL` it uses `DATABASE_URL` from `.env`, which is the
local database. Check the first line it prints ("Dumping <host>...") to see
which one it read.

The production connection string is in Railway, on the Postgres service's
Variables (the public one, usually `DATABASE_PUBLIC_URL`). Do not save it in a
file in the repo.

Taking a backup only reads. It cannot change the database.

## Prove it restores

```
npm run db:backup:verify
```

It restores the newest dump into a throwaway Postgres container, counts the
rows in every table, prints the largest, and removes the container. "Restore
check passed" means the dump is a complete, loadable database.

```
BACKUP_DATABASE_URL="<the production connection string>" npm run db:backup:verify -- --compare
```

The same, and it compares every table's row count with the live database. If
the app was used after the dump was taken, a few tables will differ by a few
rows; that is expected and it says so. A table that is missing, or far short,
is a real problem.

To check an older dump, give its path: `npm run db:backup:verify -- backups/<file>`.

## Restoring for real

Only if production is lost. Into a **new, empty** database:

```
docker run --rm -v "$PWD/backups:/b" postgres:17-alpine \
  pg_restore --no-owner --no-acl -d "<the new database's connection string>" /b/<file>.dump
```

Then point the API at the new database and run `npm run db:migrate`, which
applies anything newer than the dump. Uploaded files (attachments, PDFs) are
not in the database; they are on the Railway volume and need their own copy.

## What was tested

On 10-13, against a throwaway database with every migration applied: dump,
restore, and the row-count comparison all passed. **It has not been run against
production yet.**

## Still to do

1. Run both commands against production once and note the date here.
2. Check what Railway keeps by itself. Look for Backups on the Postgres
   service; whether it is there depends on the plan. Write down the schedule
   and how long they are kept, or that there are none.
3. Decide how often we take our own copy and where it is kept. A dump on one
   laptop is not a backup; it should go somewhere off the machine and off
   Railway.
4. The uploaded files on the Railway volume are not covered by any of this.
5. A standby copy and a written recovery plan are item 28, later.
