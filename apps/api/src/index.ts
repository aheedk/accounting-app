import { makeApp } from './app.js';
import { config } from './config.js';
import { db } from './db/index.js';
import { startRecurringScheduler } from './jobs/recurringScheduler.js';
import { startGmailWorker } from './jobs/gmailWorker.js';
import { loadRecentRevocations } from './services/auth/sessionRevocation.js';

const port = Number(process.env.PORT ?? config.API_PORT);

const server = makeApp().listen(port, '::', () => {
  console.log(`api listening on port ${port}`);
  // Started here (not app.ts) so tests and supertest never spin up timers.
  startRecurringScheduler(db);
  startGmailWorker(db);
  // Logins switched off or signed out shortly before a restart stay that way.
  void loadRecentRevocations(db, config.JWT_ACCESS_TTL_MINUTES).catch((e: unknown) => {
    console.error('[auth] could not load recent sign-outs:', e instanceof Error ? e.message : e);
  });
});
// Reading a long scanned statement with the AI can take several minutes;
// Node's default 5-minute request timeout would cut the upload off.
server.requestTimeout = 15 * 60 * 1000;
