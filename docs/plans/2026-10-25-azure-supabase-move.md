# Moving to Azure and Supabase — plan

Decided 10-25: production moves off Railway and Netlify. The API and the web
app go to Azure, and the database and uploaded files go to Supabase. This file
is the plan and the checklist. Delete it once the move is done and the guides
below are updated.

## Where everything goes

| Part | Now | After |
|---|---|---|
| API (also runs the Gmail inbox and recurring entries on timers) | Railway | **Azure App Service**, Linux, from a container. Region **East US** |
| The API's image | Built by Railway | **Azure Container Registry** (Basic), built by GitHub Actions after CI passes |
| Web app | Netlify | **Azure Static Web Apps** (Standard, for the uptime SLA) |
| Database | Railway Postgres | **Supabase**, Pro plan. Region **East US (North Virginia)**, next to Azure's East US |
| Uploaded files | Railway volume, in no backup | A private **Supabase Storage** bucket, through the S3 code already in `lib/fileStorage.ts` |
| Gmail credentials and token | Railway | App Service's persistent storage, `/home/secrets` |
| AI, Gmail, our own sign-in | — | Unchanged. We do not use Supabase's sign-in or its Data API |

## Ready in the repo (10-25)

| What | Checked |
|---|---|
| `Dockerfile`, `.dockerignore`: the API as a container. It runs the migrations, then starts | Built and run against the local database: it migrated, started, and answered `/health` with the security headers |
| `lib/forwardedFor.ts`: Azure's front end puts the port on the visitor's address (`203.0.113.7:51234`). The audit log's `inet` column refuses that, so **every audited request, sign-in included, would have failed**, and the sign-in limit would have seen each connection as a new address. The port is now taken off | Unit test. In the container, a failed sign-in sent from `203.0.113.7:51234` was recorded as `203.0.113.7` |
| `bin/migrate.ts`: on Supabase, the roles its Data API uses (`anon`, `authenticated`) get no access to our tables, and no access to new tables either. It runs on every deploy and does nothing where those roles don't exist | Locally with stand-in roles: they could read `journal_entries` before, nothing after, and not a table created later |
| `bin/upload-files.ts` (`npm run files:upload -- <folder>`): copies the uploaded files into the bucket, keeping each one's path. It skips files already there | Usage only. Its S3 calls are the ones `lib/fileStorage.ts` makes |
| `apps/web/staticwebapp.config.json`: the headers from `netlify.toml` and the fallback to `index.html`. The deploy fills in the API's address | Valid JSON. Not served yet |
| `.github/workflows/deploy-azure.yml`: after CI passes on `main`, builds the image in the registry and points App Service at it, then builds and uploads the web app. Every push deploys both, so nothing is skipped the way Railway's watch paths skipped pushes. **It does nothing until its variables are set** | Parses. Not run: Azure does not exist yet |

## The firm does (accounts in the firm's name)

1. **Supabase.** Create an organization in the firm's name on the Pro plan,
   and a project in East US (North Virginia). Keep the database password in
   the firm's password manager.
2. **Azure.** Create a subscription in the firm's name, under the firm's
   Microsoft 365 if it has one. Create a resource group, `accounting-prod`, in
   East US, and give Aheed the Contributor role on it.
3. Sign in, and Aheed sets up the rest. Claude can drive the portals once
   someone is signed in.

## Setting up

### Supabase

1. **Turn the Data API off** (Project Settings → Data API). The lockdown in
   `bin/migrate.ts` is the second line of defence. Afterwards, the Security
   Advisor should list no table open to `anon`.
2. **Get the SSL certificate.** Download it from Database Settings → SSL and
   commit it as `apps/api/certs/supabase-ca.crt`. It is public, and the image
   picks it up with `apps/api`.
3. **Build the connection string** from **Connect → Session pooler** (IPv4,
   port 5432).
   - Don't use the direct connection: it is IPv6 only, and App Service cannot
     reach it.
   - Don't use the transaction pooler on 6543.
   - Add `?sslmode=verify-full&sslrootcert=apps/api/certs/supabase-ca.crt`, so
     the API checks it is really talking to Supabase.
4. **Storage.** Create a private bucket, `uploads`. Under Storage → S3
   Connection, create an access key. The endpoint is
   `https://<project>.supabase.co/storage/v1/s3`, and the region is the
   project's (`us-east-1`).
5. **Backups.** The Pro plan takes daily backups. Add point-in-time recovery
   too: it restores to any minute, and the books are worth it.

### Azure

1. **Container registry**, Basic, in `accounting-prod`.
2. **App Service.** A Linux plan (B1 to start; see "Later"), and a Web App for
   Containers on it.
   - Turn on its system-assigned identity and give that identity AcrPull on the
     registry, so no registry password is stored.
   - Settings: Always On on, health check `/health`, HTTPS only, TLS 1.2 at
     least, FTP off, **one instance**. Two instances would run the timer jobs
     twice.
3. **App settings.** Copy every variable from Railway's API service, with
   these changes:
   - `DATABASE_URL`: the Supabase string from above.
   - `S3_BUCKET=uploads`, `S3_ENDPOINT`, `AWS_REGION=us-east-1`,
     `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`: from Supabase Storage.
   - `CORS_ALLOWED_ORIGINS`: the Static Web App's address.
   - `GMAIL_CREDENTIALS_PATH=/home/secrets/gmail-credentials.json`,
     `WEBSITES_ENABLE_APP_SERVICE_STORAGE=true`, `WEBSITES_PORT=8080`.
   - **`FIELD_ENCRYPTION_KEY` must be the same value as on Railway**, or the
     encrypted SSNs, tax IDs and two-step secrets cannot be read. Keep the JWT
     secrets the same too.
   - Put the secrets in a Key Vault and reference them from the settings.
4. **Static Web App** (Standard). Its deployment token goes into GitHub as the
   secret `AZURE_STATIC_WEB_APPS_API_TOKEN`.
5. **GitHub's sign-in to Azure.** An app registration with a federated
   credential for this repository's `main` branch, so no password is stored.
   Give it AcrPush on the registry and Website Contributor on the web app.
6. **GitHub variables** (Settings → Secrets and variables → Actions):
   `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
   `AZURE_RESOURCE_GROUP`, `AZURE_REGISTRY` (the name, without `.azurecr.io`),
   `AZURE_WEBAPP_NAME`, and `API_ORIGIN` (`https://<app>.azurewebsites.net`).
   Setting them switches the workflow on.

## Trial run (Railway stays live)

1. Dump production (`npm run db:backup` with Railway's connection string) and
   restore it into Supabase (`docs/guides/backups.md`, "Restoring for real").
2. Run the deploy workflow (Actions → Deploy to Azure → Run workflow).
3. On the Static Web App's address:
   - sign in;
   - open two clients;
   - compare a Balance Sheet with Railway's;
   - upload an attachment and open it again.
4. Check that the Activity Log shows your own address, and that the deploy log
   says "Supabase roles anon and authenticated: no access to public."

## Switch-over (one evening)

1. **Freeze.** Tell the firm nothing is entered for about two hours.
2. **Database.** Take the final dump from Railway. Empty the trial's data
   (drop and recreate `public`), then restore the dump into Supabase.
3. **Files.** `railway ssh` into the API service, then run
   `npm run files:upload -- "$FILE_STORAGE_DIR"` there with the Supabase
   Storage variables set. The script is in the deployed code, so nothing
   needs downloading.
4. **Deploy.** Run the deploy workflow, which migrates and locks down again.
5. **Gmail.** Put `gmail-credentials.json` into `/home/secrets` (App Service →
   SSH), then reconnect Gmail as a firm admin.
6. **Old address.** Change `netlify.toml` to send every page to the new
   address (301), so old bookmarks keep working.
7. **Phone app.** Riham sets `EXPO_PUBLIC_API_URL` to the new API and ships a
   build.
8. **Everyone signs in again.** The API's address changed, so the sign-in
   cookie is new.
9. **Railway.** Stop the API service, but don't delete it. Keep it two weeks
   as the way back, with the final dump.

**Going back:** if the new setup fails before anyone has entered anything
there, start Railway's service again and undo the Netlify redirect. If work
was already entered on the new one, dump Supabase and restore it into
Railway's database first. Decide by the next morning.

## After the move, update

- `docs/guides/recovery-plan.md` and `docs/guides/backups.md`: Azure and
  Supabase in place of Railway, and Supabase's backups beside our own copy.
- Remove `railway.json`, `nixpacks.toml`, and `netlify.toml` (once the
  redirect has had a few weeks).
- `docs/qa/2026-10-20-security-review.md`: the uploads gap is closed.
- Rewrite the Railway and Netlify notes in Claude's memory.

## Later (before January 1)

- **A staging slot.** Railway's health check kept the old version serving
  when a new one failed to start. On App Service B1, a failed start means
  downtime until it is fixed. A Premium v3 plan (P0v3) adds a staging slot:
  deploy there, and swap once `/health` answers. The workflow changes by one
  step.
- **Supabase network restrictions.** Allow only App Service's outbound
  addresses (and ours for backups), so the database cannot be reached from
  anywhere else.
- **The API under the web app's own domain** (a custom domain, or a Static Web
  Apps linked backend). This closes the security review's local-storage item.
- **Enforce the script policy** in `staticwebapp.config.json`, as the security
  review says.
