# accounting-app

Production-grade accounting system for an accounting firm. See `docs/superpowers/specs/` for the design spec.

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

## Manual smoke test (Slice 1 Foundation)
1. `docker compose up -d postgres && npm run db:migrate && npm run db:seed`
2. `npm run dev`
3. Open http://localhost:5173, log in with the seeded admin account.
4. Verify: dashboard loads, "Sign out" returns to login, reload keeps the anonymous state.
