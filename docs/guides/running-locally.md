# Starting localhost

Run these commands from `D:\coding projects\accounting-app`.

## Normal startup

1. Start Docker Desktop if it is not already running:

   ```powershell
   Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
   ```

2. Wait until Docker Desktop says the engine is running, then start Postgres:

   ```powershell
   docker compose up -d postgres
   ```

3. Apply any new database migrations:

   ```powershell
   npm run db:migrate
   ```

4. Start the API and website:

   ```powershell
   npm run dev
   ```

5. Open <http://localhost:5173>.

Keep the terminal running while using the app. The local API runs at
<http://localhost:4000> and Postgres uses port `5434` on this computer.

## If login fails

Check each part in this order:

```powershell
docker compose ps
Invoke-WebRequest -UseBasicParsing http://localhost:4000/health
Invoke-WebRequest -UseBasicParsing http://localhost:5173
```

Expected results:

- `postgres` says `healthy`.
- The API response contains `{"status":"ok"}`.
- The website response has status code `200`.

If Docker reports that it cannot connect to `docker_engine`, Docker Desktop is
not ready yet. Start Docker Desktop, wait for the engine, and repeat the normal
startup commands.

## First setup only

Use these after a new clone or when the local database has no demo login data:

```powershell
npm install
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev
```

Do not run `npm run db:reset` for normal startup because it replaces the local
database contents.

## If the API or website will not start

On Windows, stopping `npm run dev` from a background task can leave its
`node.exe` processes running (concurrently, `tsx watch`, the API on port 4000,
and vite). A leftover API keeps port 4000 busy, and each restart stacks another
set, which eats memory. Clear them, then start again:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'accounting-app' -and $_.CommandLine -match 'concurrently|tsx|vite|src/index\.ts' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
npm run dev
```

## Stopping localhost

Press `Ctrl+C` in the terminal running `npm run dev`. To stop Postgres too:

```powershell
docker compose stop postgres
```

## Developer notes

- **After editing anything in `packages/shared`**, run
  `npm -w @accounting/shared run build`. The API and web use the compiled
  `dist/`, and a stale build causes confusing typecheck errors.
- **Integration tests need Docker Desktop running** (they start Postgres with
  testcontainers). From `apps/api`:
  `npx vitest run tests/integration/<file>`; the full suite runs one file at a
  time by default.
- **Local data vs production:** `apps/web/.env.local` (gitignored) sets
  `VITE_DEV_PROXY_TARGET`. `http://localhost:4000` uses the local Docker
  database; pointing it at the Railway API uses real production data.
- **Dates:** never pass a date-only string through `new Date()` for display
  (UTC midnight shows as the previous day in US timezones). Use `todayLocal()`,
  `fmtLongDate()` and the other helpers in `apps/web/src/lib/dates.ts`.
- **Report SQL:** a `LEFT JOIN ... AND <filter>` does not filter rows. Put
  account-type restrictions in the `WHERE` or inside the aggregate, or the
  report sums both sides of balanced entries to zero.
- **Browser testing:** Chrome may autofill saved production credentials on the
  local login page. Replace both fields with the local seed account; never
  submit the autofilled ones.
