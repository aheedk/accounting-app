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
| `deploy/azure/Dockerfile` and its `Dockerfile.dockerignore`: the API as a container. It runs the migrations, then starts. Kept out of the repo root: a root Dockerfile makes Railway build with it instead of Nixpacks, and Railway then runs only the first half of the `&&` start command, so no deploy started from 10-26 to 10-28 | Built and run against the local database: it migrated, started, and answered `/health` with the security headers |
| `lib/forwardedFor.ts`: Azure's front end puts the port on the visitor's address (`203.0.113.7:51234`). The audit log's `inet` column refuses that, so **every audited request, sign-in included, would have failed**, and the sign-in limit would have seen each connection as a new address. The port is now taken off | Unit test. In the container, a failed sign-in sent from `203.0.113.7:51234` was recorded as `203.0.113.7` |
| `bin/migrate.ts`: on Supabase, the roles its Data API uses (`anon`, `authenticated`) get no access to our tables, and no access to new tables either. It runs on every deploy and does nothing where those roles don't exist | Locally with stand-in roles: they could read `journal_entries` before, nothing after, and not a table created later |
| `bin/upload-files.ts` (`npm run files:upload -- <folder>`): copies the uploaded files into the bucket, keeping each one's path. It skips files already there | Usage only. Its S3 calls are the ones `lib/fileStorage.ts` makes |
| `apps/web/staticwebapp.config.json`: the headers from `netlify.toml` and the fallback to `index.html`. The deploy fills in the API's address | Valid JSON. Not served yet |
| `.github/workflows/deploy-azure.yml`: after CI passes on `main`, builds the image in the registry and points App Service at it, then builds and uploads the web app. Every push deploys both, so nothing is skipped the way Railway's watch paths skipped pushes. It reads the Static Web App's deployment token at deploy time (10-31), so no token is stored in GitHub. **Each job does nothing until its variables are set** | Parses. Not run: Azure does not exist yet |
| `GMAIL_REDIRECT_URI` (10-31): which callback the Gmail connection uses, when Google's client lists both Railway's and Azure's | Typechecks |
| `bin/copy-to-supabase.sh` (11-01): `check`, `copy` (into an empty Supabase) or `replace` (empties it first). Takes a fresh dump of Railway, restores it with Postgres 18's tools in Docker, compares every table's row count. Reads both connection strings from `secrets/migration.env` (git-ignored) and prints neither | The trial copy below |

## The firm does (accounts in the firm's name)

1. **Supabase.** Create an organization in the firm's name on the Pro plan,
   and a project in East US (North Virginia) on the Micro compute size the
   plan includes. Keep the database password in the firm's password manager.
   Invite Aheed to the organization as Administrator.
2. **Azure.** Create a pay-as-you-go subscription in the firm's name, signed in
   with the firm's Microsoft 365 account so it sits in the firm's directory.
   - Register the resource providers `Microsoft.Web`,
     `Microsoft.ContainerRegistry` and `Microsoft.KeyVault` on the
     subscription. That needs the subscription, so Aheed can't do it from the
     resource group.
   - Create a resource group, `accounting-prod`, in East US, and give Aheed the
     **Owner** role on it, with the recommended condition (no Owner or access
     administrator roles). Not Contributor: the setup gives the web app access
     to the registry and GitHub access to deploy, and a Contributor can't give
     access.
   - If Aheed is a guest in the firm's directory, give them the Application
     Developer role in Entra ID, so they can register GitHub's sign-in. A
     guest can't by default.
3. **Secrets.** Copy `FIELD_ENCRYPTION_KEY`, `JWT_ACCESS_SECRET`,
   `JWT_REFRESH_SECRET` and `ANTHROPIC_API_KEY` from Railway's API service into
   the firm's password manager.
4. Sign in, and Aheed sets up the rest. Claude can drive the portals once
   someone is signed in.

## Setting up

### Supabase

1. **Turn the Data API off** (Project Settings → Data API). Off as of 11-01. The lockdown in
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
5. **Backups.** The Pro plan takes a backup every day and keeps the last 7.
   No point-in-time recovery for now (10-29): it restores to any minute, but
   it is $100 a month on top of the plan's $25. It can be turned on later.

### Azure

**Done 10-31:** the registry `khanarndtapps`, the Key Vault `khanarndt-acct-kv`
(Aheed is Key Vault Secrets Officer), the Static Web App
`khanarndt-accounting-web` (East US 2, `agreeable-pond-02cc2310f.6.azurestaticapps.net`),
GitHub's sign-in `github-deploy-accounting-app` with its roles, and every GitHub
variable except `AZURE_WEBAPP_NAME` and `API_ORIGIN`.

**Done 11-05:** the quota was raised. Created the plan `khanarndt-accounting-plan`
(Linux, B1, East US, one instance) and the web app `khanarndt-accounting-api` on
it, at **`https://khanarndt-accounting-api-g2fjghhefjdrgcfm.eastus-01.azurewebsites.net`**:
Azure now gives a new app a unique default hostname, not `<app>.azurewebsites.net`,
so that is the address wherever this plan says `<app>.azurewebsites.net`.
- Sidecar support is **off**: the deploy uses `az webapp config container set`,
  the single-container command. It runs Azure's sample page until the first deploy.
- System-assigned identity on; it pulls from the registry with it
  (`acrUseManagedIdentityCreds`). Always On, health check `/health`, HTTPS only,
  TLS 1.2, FTP and basic authentication off. No Application Insights.
- Every app setting in step 3 is set, the seven secrets as Key Vault references
  (`@Microsoft.KeyVault(VaultName=khanarndt-acct-kv;SecretName=…)`).
  `ANTHROPIC_WORKSPACE_ID` is optional: copy it too if Railway has it.
- GitHub variables `AZURE_WEBAPP_NAME` and `API_ORIGIN` are set, so the deploy
  is switched on.
- **Roles given 11-06** (Aheed, in Cloud Shell): AcrPull on the registry and Key
  Vault Secrets User on the vault for the web app's identity, and Website
  Contributor on the web app for GitHub's sign-in.
- **Left:** the seven secrets in the vault (`field-encryption-key` is a new
  key, see step 3 below), Supabase Storage's bucket and key, and the Azure
  callback in Google's client.

**Was waiting on Microsoft (resolved by 11-05):** a new subscription may run no App Service at all in
East US (every size's quota is 0 of 0; Central US had 30). Only a subscription
Contributor or Owner can raise it: Quotas → App Service → East US → **B1 VMs** →
request 1. Asif, who set up the firm's Azure and Supabase, asked on 10-31; the
portal couldn't raise it, so it went to Microsoft as support ticket
2610310040001721 (severity C, a reply by email to Asif in business hours). The
plan `khanarndt-accounting-plan` and the web app `khanarndt-accounting-api`
follow. Central US would work today, but every query would cross to the
database in Virginia.

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
     secrets the same too. **Found 11-06: Railway has no `FIELD_ENCRYPTION_KEY`**,
     and its database holds no encrypted value (0 vendor tax IDs, 0 SSNs, 0
     two-step secrets), so saving any of them there fails. A new key is made
     in the vault, and the same value goes onto Railway, so nothing saved
     before the switch-over is encrypted with a different key.
   - Put the secrets in a Key Vault and reference them from the settings. In
     `khanarndt-acct-kv`: `database-url`, `jwt-access-secret`,
     `jwt-refresh-secret`, `field-encryption-key`, `anthropic-api-key`,
     `aws-access-key-id`, `aws-secret-access-key`. The web app's identity gets
     Key Vault Secrets User on the vault.
   - `GMAIL_REDIRECT_URI=https://<app>.azurewebsites.net/auth/gmail/callback`,
     and the same address added to the Google client's redirect URIs.
4. **Static Web App** (Standard). East US 2: Static Web Apps has no East US.
5. **GitHub's sign-in to Azure.** An app registration with a federated
   credential for this repository's `main` branch, so no password is stored.
   Give it Contributor on the registry (`az acr build` runs a registry task,
   which AcrPush can't), Contributor on the Static Web App (the workflow reads
   its deployment token) and Website Contributor on the web app.
6. **GitHub variables** (Settings → Secrets and variables → Actions):
   `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
   `AZURE_RESOURCE_GROUP`, `AZURE_REGISTRY` (the name, without `.azurecr.io`),
   `AZURE_STATIC_WEB_APP`, `AZURE_WEBAPP_NAME`, and `API_ORIGIN`
   (`https://<app>.azurewebsites.net`). `AZURE_WEBAPP_NAME` switches the API's
   deploy on, and `API_ORIGIN` the web app's.

## Trial run (Railway stays live)

1. **Done 11-01.** Copy production into Supabase: `bin/copy-to-supabase.sh copy`,
   then the migrations from this machine with the API's certificate check:
   `DATABASE_URL="<Supabase session pooler string>?sslmode=verify-full&sslrootcert=apps/api/certs/supabase-ca.crt" npm run db:migrate`.
   - Railway runs **Postgres 18.6** and Supabase **17.11**. Version 17's
     `pg_dump` refuses an 18 database, so the backup tool now uses 18
     (`docs/guides/backups.md`); 18's dump restored into 17 without trouble. The
     app is tested on 16.
   - All 77 tables matched in row count. The 13 companies, 3 logins and the
     ledger's debits and credits (47,991,723.28 each) matched, and a fingerprint
     of every journal line was the same on both.
   - The migrations added 0114 and 0115 and printed "Supabase roles anon and
     authenticated: no access to public"; `anon` can read no table. The Data API
     was already off. The certificate check (`verify-full`) worked.
   - The pooler only took the password after it was reset and pasted in, not
     typed: a wrong one gives "password authentication failed for user
     postgres". The project is on `aws-0-us-east-1`; `aws-1` doesn't know it.
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
2. **Database.** `bin/copy-to-supabase.sh replace`: it takes the final dump from
   Railway, empties the trial's data (drops and recreates `public`), restores
   the dump into Supabase and compares the row counts. Keep that dump with the
   Railway service (step 9).
3. **Files.** `railway ssh` into the API service, then run
   `npm run files:upload -- "$FILE_STORAGE_DIR"` there with the Supabase
   Storage variables set. The script is in the deployed code, so nothing
   needs downloading.
4. **Deploy.** Run the deploy workflow, which migrates and locks down again.
5. **Gmail.** Copy `gmail-credentials.json` and `gmail-token.json` from
   Railway's secrets folder into `/home/secrets` (App Service → SSH). With the
   token there, Gmail keeps working without reconnecting. If it has to be
   reconnected, the Azure callback must be in the Google client first.
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
