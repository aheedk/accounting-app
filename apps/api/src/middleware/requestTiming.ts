import type { Request, Response, NextFunction } from 'express';
import { getPoolStats } from '../db/index.js';

// Diagnostic only: logs any request whose full lifecycle (middleware + route
// handler + response flush) exceeds the threshold. Mounted first, before cors/
// auth/body-parsing, so the timer covers everything — including whatever's
// actually slow, not just the route handler. Also snapshots DB pool
// utilization at request start vs finish — if `waiting` is > 0, requests are
// genuinely queuing for a connection; if total/idle look normal throughout,
// the time is going somewhere other than pool contention.
const SLOW_THRESHOLD_MS = 150;

export function requestTiming(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  const startedAt = new Date().toISOString();
  const poolAtStart = getPoolStats();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (ms > SLOW_THRESHOLD_MS) {
      const poolAtEnd = getPoolStats();
      console.warn(
        `[SLOW] ${req.method} ${req.originalUrl} — ${ms.toFixed(0)}ms (status ${res.statusCode})` +
        ` start=${startedAt} end=${new Date().toISOString()}` +
        ` pool@start=${JSON.stringify(poolAtStart)} pool@end=${JSON.stringify(poolAtEnd)}`,
      );
    }
  });
  next();
}
