import { makeApp } from './app.js';
import { config } from './config.js';
import { db } from './db/index.js';
import { startRecurringScheduler } from './jobs/recurringScheduler.js';
import { startGmailWorker } from './jobs/gmailWorker.js';

const port = Number(process.env.PORT ?? config.API_PORT);

makeApp().listen(port, '::', () => {
  console.log(`api listening on port ${port}`);
  // Started here (not app.ts) so tests and supertest never spin up timers.
  startRecurringScheduler(db);
  startGmailWorker(db);
});
