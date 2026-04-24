# accounting-app

Production-grade accounting system for an accounting firm. See `docs/superpowers/specs/` for the design spec.

## Deployed environments

- **API:** `<paste Railway URL here>`
- **Web:** `<paste Netlify URL here>`

Admin credentials are stored in 1Password. If lost, open a Railway shell and re-run `ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx bin/create-admin.ts`.

## Quickstart

```bash
nvm use
npm install
docker compose up -d postgres
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

Then visit http://localhost:5173.

## Required env vars

- `DATABASE_URL` — Postgres connection string.
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — JWT signing secrets.
- `FIELD_ENCRYPTION_KEY` — 32-byte hex key for sensitive-field encryption (vendor tax IDs, employee SSNs). Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Rotating this key invalidates all encrypted fields — back them up first.

## Manual smoke test (Slice 1 Foundation)
1. `docker compose up -d postgres && npm run db:migrate && npm run db:seed`
2. `npm run dev`
3. Open http://localhost:5173, log in with the seeded admin account.
4. Verify: dashboard loads, "Sign out" returns to login, reload keeps the anonymous state.
