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

## Stopping localhost

Press `Ctrl+C` in the terminal running `npm run dev`. To stop Postgres too:

```powershell
docker compose stop postgres
```
