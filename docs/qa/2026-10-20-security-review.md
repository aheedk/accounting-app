# Security review — 2026-10-20

Part of item 28 in the meeting notes, before real client data arrives on
November 1. A read of the API for one client reaching another's data, unsafe
files, and how logins and sessions are handled. The Gmail connect hole found
earlier is already closed (`b0d791d`).

## Fixed

### A record's id reached another client's record

Every route under `/businesses/:businessId` checks that the login may open that
client (`middleware/tenancy.ts`). But the record itself is named by its own id
in the URL or body, and 60 service lookups found it by that id alone. Someone
who could open one client could post, void, change or delete a record of
another client in the firm by putting its id in a request to their own client:
post an invoice, close a period, rename a vendor, finalise a pay run, and so on.

Ids are random UUIDs, so this needed an id from another client, which nothing
shows. Still, it is exactly the gap a client login or a staff member limited to
some clients must not have.

**Fix:** `scopeBusiness(ctx)` (`lib/ctx.ts`) returns the request's client, and
each of those 60 lookups now also matches `business_id` on it, so an id from
another client is "not found". It refuses outright when a caller set no client;
every request and scheduled job sets one. Test: `tenantScope.test.ts`.

The four AI inbox routes had the same gap in the route itself: approving or
rejecting a statement or an invoice found the import by id alone, and rejecting
also moved it to the caller's client. Both now match the client.

Not changed, deliberately:

- Payment application lookups (`payment_applications`,
  `bill_payment_applications`) have no client column; the payment they belong
  to is matched first, in the same function.
- The ledger already refused accounts from another client
  (`assertPostableAccounts`).

Checks and expenses had the same gap for their payee: the vendor or customer id
was saved as given, and its name read by id alone. Both now look the payee up
within the client and refuse one from elsewhere (`resolvePayeeName` in the
check and expense services).

### Uploaded files were sent back as whatever type the uploader claimed

`POST /files` stores the type the browser declares, and the download sent it
back as that type, shown in the browser. An HTML or SVG file uploaded as an
attachment and then opened in a tab through a `blob:` URL would run inside the
app, where the sign-in token is kept. Today's pages save attachments rather than
open them, and the one page that opens a file in a tab (check stubs) only gets
PDFs and images from the AI upload, so this was not open to attack.

**Fix (so a future page cannot open it up):** only PDF, PNG, JPEG, GIF, WebP,
plain text and CSV are sent to be shown; anything else goes as
`application/octet-stream`, to be saved (`downloadHeaders` in
`services/files/fileService.ts`). Every API response now also carries
`X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.

### Sign-in

- **One address trying many logins.** Each login already locked after 5 wrong
  tries; one address could still try a common password against every email.
  Now 20 failed sign-ins from one address within 15 minutes refuse that address
  until the 15 minutes are up (`lib/loginThrottle.ts`). A successful sign-in
  from the address clears its count, so if every visitor ever looked like one
  address, ordinary use would keep clearing it rather than lock the firm out.
- **The real address behind Railway.** The API now trusts the one proxy in
  front of it (`app.set('trust proxy', 1)`), so the address is the visitor's,
  not Railway's. This is also what the Activity Log records. **After the next
  deploy, check that the Activity Log shows different addresses for different
  people;** if every sign-in shows the same one, the setting needs changing.
- **Which emails have logins.** A wrong email was answered faster than a wrong
  password (no password check ran), so timing told which emails exist. A wrong
  email now runs the same check against a stand-in.

### The web app's headers

`apps/web/netlify.toml` now sends `X-Content-Type-Options`, `X-Frame-Options:
DENY` (the app cannot be framed by another site) and a referrer policy, and a
Content-Security-Policy that limits scripts to the app itself, styles and fonts
to the app and Google Fonts, and requests to the app and the API. The policy is
**report-only** for now: it blocks nothing, and lists in the browser console
what it would have blocked. Once the console on the live site shows no reports,
rename the key to `Content-Security-Policy` to enforce it. If the web app is
not hosted on Netlify, these lines do nothing and the same headers go in that
host's settings.

## Checked, nothing to fix

- **Which client a login may open** (`resolveBusiness`): the client must be in
  the login's firm and granted to it, or the login is a firm admin. A client
  login is refused anything not on its list (`lib/clientAccess.ts`).
- **Roles on changes:** `roleMatrix.test.ts` calls every route as every role.
- **Sign-in:** wrong passwords and wrong two-step codes lock a login for a
  while; the refresh token is an `httpOnly`, `secure` cookie limited to `/auth`.
- **CORS:** only the listed origins, with credentials.
- **Request size:** JSON bodies are capped at 1 MB, uploads at 10 MB (25 MB for
  statements).
- **SQL:** queries go through Kysely with parameters. The one raw piece, the
  sort column on Transactions, comes from a fixed list.
- **Secrets in the database:** SSNs, vendor tax IDs and two-step secrets are
  encrypted with `FIELD_ENCRYPTION_KEY`. Keeping that key safe and separate is
  in [`../guides/recovery-plan.md`](../guides/recovery-plan.md).

## Still open

- **Enforce the Content-Security-Policy** once the report-only one shows no
  reports on the live site (above).
- **The access token is kept in the browser's local storage**, the usual
  trade-off for a single-page app: any script that runs in the app can read it.
  The protection is not letting outside script run; the policy above is the
  second line.
- **Uploaded files are not backed up** (`../guides/backups.md`, step 4).
- **A standby copy of the database** (item 28) is not set up.
