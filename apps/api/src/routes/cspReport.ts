import express, { Router } from 'express';
import { RateLimit } from '../lib/rateLimit.js';

// Where browsers report what the web app's Content-Security-Policy would have
// blocked (report-only for now; apps/web/netlify.toml). Each report is one line
// in the API's log, "[csp] ...", so the deploy log says whether enforcing the
// policy would break anything, without anyone watching a browser console. No
// sign-in: browsers send these on their own. Security review 2026-10-21.

const router = Router();

// One address cannot fill the log.
const reportsPerAddress = new RateLimit(100, 60 * 60_000);

type LegacyReport = { 'csp-report'?: Record<string, unknown> };
type ReportingApiEntry = { type?: string; url?: string; body?: Record<string, unknown> };

function line(report: Record<string, unknown>, page?: string): string {
  const pick = (...keys: string[]) => keys.map(key => report[key]).find(value => typeof value === 'string' && value !== '') as string | undefined;
  const directive = pick('effective-directive', 'effectiveDirective', 'violated-directive') ?? '?';
  const blocked = pick('blocked-uri', 'blockedURL') ?? '?';
  const where = page ?? pick('document-uri', 'documentURL') ?? '?';
  const source = pick('source-file', 'sourceFile');
  // The page's path only: a query string could carry something personal.
  const path = (url: string) => url.split('?')[0]!.slice(0, 200);
  return `[csp] ${directive} blocked ${path(blocked)} on ${path(where)}${source ? ` (from ${path(source)})` : ''}`;
}

router.post(
  '/csp-report',
  express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '16kb' }),
  (req, res) => {
    if (reportsPerAddress.take(req.ip ?? 'unknown') === null) {
      const body = req.body as LegacyReport | ReportingApiEntry[] | undefined;
      if (Array.isArray(body)) {
        for (const entry of body.slice(0, 10)) if (entry?.body) console.warn(line(entry.body, entry.url));
      } else if (body?.['csp-report']) {
        console.warn(line(body['csp-report']));
      }
    }
    res.status(204).end();
  },
);

export default router;
