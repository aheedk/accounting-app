# Recovery plan

What to do when production breaks, written before November 1 when real client
data arrives (item 28 in the meeting notes). Each case says how to tell it has
happened, what to do, and what is lost. Taking and checking backups is in
[`backups.md`](./backups.md).

Production is on Railway: the API service (`@accounting/api`,
https://accountingapi-production.up.railway.app), its Postgres service, and a
volume holding uploaded files. The web app is on Netlify,
https://shiny-dusk-be3da0.netlify.app. Each deploys from `main` on its own, so
one can fall behind the other: in October 2026 Netlify stopped picking up pushes
for a week, then Railway did. To see what is live, compare the web bundle or the
API's response headers with the newest commit.

## Keep these somewhere other than Railway

A database copy is not enough on its own. Keep these in a password manager the
firm controls, not only in Railway's Variables:

| Secret | Why it matters |
|---|---|
| `FIELD_ENCRYPTION_KEY` | Encrypts employee SSNs, vendor tax IDs and every user's two-step sign-in secret. **If it is lost, a restored database cannot read any of them, and everyone with two-step sign-in is locked out.** There is no way to recover the data without it. Never change it on a running database; the old values stop decrypting |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Sign the logins. Losing them only signs everyone out; changing them is how to throw out stolen sessions (see "A secret leaked") |
| `ANTHROPIC_API_KEY` | AI document reading. Replaceable from the Anthropic console |
| `secrets/gmail-credentials.json` and `gmail-token.json` | The firm inbox. Replaceable by reconnecting Gmail as a firm admin |
| The Postgres connection string | Needed to take a backup. Railway shows it again, so it does not need a copy |

## The app is down

**How it shows:** the site does not load, or every page says it cannot reach the
server.

1. Railway → API service → Deployments. If the newest deploy failed, the
   previous one is still serving; read the failed deploy's log.
2. If the newest deploy is running but broken, use **Redeploy** on the last good
   deployment. Migrations only ever add, so an older build runs on the newer
   database; check the migrations in the bad deploy before rolling back past
   one that renamed or dropped something.
3. If the database is the problem (the API log shows connection errors), check
   the Postgres service is running and not out of disk.

Nothing is lost.

## A bad change to data

**How it shows:** wrong figures, or entries missing after someone's mistake or a
bug.

Do not restore the whole database for this: everything entered since the backup
would be lost. Instead:

1. Find what changed in Setup → Activity Log (every change is recorded with
   who, when, and the before and after).
2. Fix it in the app the usual way: void and re-enter, or correct the entry.
3. If it is too large to fix by hand, restore the latest backup into a **new**
   database (see `backups.md`, "Restoring for real"), copy the affected rows
   across, and keep production running.

## The database is lost

**How it shows:** the Postgres service is gone, or its data cannot be read.

1. Create a new Postgres service in Railway.
2. Restore the newest backup into it (`backups.md`, "Restoring for real"). Use a
   Railway backup if it is newer than our own copy.
3. Point the API's `DATABASE_URL` at the new database and redeploy. The deploy
   runs the migrations, which applies anything newer than the backup.
4. Check `FIELD_ENCRYPTION_KEY` is the same as before: open an employee or sign
   in as a user with two-step sign-in.
5. Sign in, open two or three clients, and compare a Balance Sheet with what the
   accountants last saw.

**Lost:** everything entered since the backup. Tell the firm the backup's date
and time so they re-enter from there; bank statements can be uploaded again.

## Uploaded files are lost

**How it shows:** attachments, receipts and check stub images fail to open.

Statements and invoices waiting in the AI inbox are safe: their PDFs are kept in
the database. Attachments added to entries are on the Railway volume and are
**not in any backup today**. Until they are, they cannot be recovered.

To close this gap, one of:

- Move uploads to object storage (Cloudflare R2 or S3). The code is already
  there and switches on when `S3_BUCKET` is set (`apps/api/src/lib/fileStorage.ts`);
  the bucket keeps its own versions and copies.
- Or copy the volume on a schedule through the Railway CLI
  (`railway ssh` into the API service, `tar` the `FILE_STORAGE_DIR` folder).

## A secret leaked

**How it shows:** a key or connection string was pasted somewhere public, or a
laptop with `.env` was lost.

| What leaked | Do this |
|---|---|
| JWT secrets | Set new values in Railway and redeploy. Everyone is signed out |
| Postgres connection string | Railway → Postgres → regenerate the password, update the API's `DATABASE_URL`, redeploy |
| `ANTHROPIC_API_KEY` | Revoke it in the Anthropic console, set a new one, redeploy |
| Gmail token | Revoke the app's access in the Google account, reconnect Gmail as a firm admin |
| `FIELD_ENCRYPTION_KEY` | The encrypted fields have to be re-encrypted with a new key. There is no tool for this yet; it needs one before the key can be changed |
| A user's password | Setup → Users: switch the login off, then have them reset it |

Then check the Activity log for anything done while it was exposed.

## Someone got in who should not have

1. Switch the login off (Setup → Users) and change the JWT secrets so every session ends.
2. Read the Activity log for that login and anything it changed.
3. Correct what it changed (as in "A bad change to data").
4. Tell the firm which clients' data it could see; that may need telling the
   clients themselves.

## Still to decide

- How often our own backup runs and where it is kept (`backups.md`, "Still to do").
- Whether to move uploads to object storage (above).
- Who is called first when production is down, and who can sign in to Railway.
