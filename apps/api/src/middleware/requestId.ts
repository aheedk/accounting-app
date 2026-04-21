import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      request_id: string;
      auth?: { user_id: string; firm_id: string; role: import('../db/types.js').UserRole };
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  req.request_id = incoming && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.request_id);
  next();
}
