import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { BusinessRuleError, codeToHttpStatus } from '../lib/errors.js';
import { ERR } from '@accounting/shared';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const request_id = req.request_id ?? 'unknown';

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: ERR.VALIDATION_FAILED,
        message: 'Input validation failed',
        details: null,
        field_errors: err.flatten().fieldErrors,
      },
      request_id,
    });
  }

  if (err instanceof BusinessRuleError) {
    return res.status(codeToHttpStatus(err.code)).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? null,
        field_errors: null,
      },
      request_id,
    });
  }

  // CORS rejection from cors() middleware — surface as 403 not 500
  if (err instanceof Error && err.message?.startsWith('CORS:')) {
    return res.status(403).json({
      error: {
        code: ERR.FORBIDDEN,
        message: err.message,
        details: null,
        field_errors: null,
      },
      request_id,
    });
  }

  // Unknown — log, return INTERNAL
  console.error(`[${request_id}]`, err);
  res.status(500).json({
    error: {
      code: ERR.INTERNAL,
      message: 'Internal server error',
      details: null,
      field_errors: null,
    },
    request_id,
  });
}
