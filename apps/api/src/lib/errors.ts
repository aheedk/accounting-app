import { ERR, type ErrorCode } from '@accounting/shared';

export class BusinessRuleError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BusinessRuleError';
  }
}

export class AuthError extends BusinessRuleError {
  constructor(code: typeof ERR.UNAUTHORIZED | typeof ERR.INVALID_CREDENTIALS | typeof ERR.TOKEN_EXPIRED | typeof ERR.FORBIDDEN, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = 'AuthError';
  }
}

export class NotFoundError extends BusinessRuleError {
  constructor(entity: string, id?: string) {
    super(ERR.NOT_FOUND, `${entity} not found${id ? `: ${id}` : ''}`, { entity, id });
    this.name = 'NotFoundError';
  }
}

export function codeToHttpStatus(code: ErrorCode): number {
  switch (code) {
    case ERR.VALIDATION_FAILED: return 400;
    case ERR.UNAUTHORIZED:
    case ERR.TOKEN_EXPIRED:
    case ERR.INVALID_CREDENTIALS: return 401;
    case ERR.FORBIDDEN: return 403;
    case ERR.NOT_FOUND: return 404;
    case ERR.CLOSED_PERIOD:
    case ERR.UNBALANCED_ENTRY:
    case ERR.INVALID_STATE_TRANSITION:
    case ERR.IMMUTABLE_RECORD:
    case ERR.OVERAPPLICATION:
    case ERR.DUPLICATE_RESOURCE:
    case ERR.PRECONDITION_FAILED: return 409;
    case ERR.INTERNAL:
    default: return 500;
  }
}
