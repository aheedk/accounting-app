export const ERR = {
  // Input
  VALIDATION_FAILED: 'VALIDATION_FAILED',

  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  // Too many wrong passwords; the login is held for a while.
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  // The password was right and the login asks for a code from an authenticator app.
  TWO_STEP_REQUIRED: 'TWO_STEP_REQUIRED',
  // Signed in, but the login must first choose its own password or set up the
  // second step; nothing else opens until it has.
  ACCOUNT_SETUP_REQUIRED: 'ACCOUNT_SETUP_REQUIRED',
  // Too many of something that costs per call (documents read by the AI) in a while.
  RATE_LIMITED: 'RATE_LIMITED',

  // Resource
  NOT_FOUND: 'NOT_FOUND',

  // Business rules (used by 1.1 and 1.2 as well)
  CLOSED_PERIOD: 'CLOSED_PERIOD',
  UNBALANCED_ENTRY: 'UNBALANCED_ENTRY',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  IMMUTABLE_RECORD: 'IMMUTABLE_RECORD',
  OVERAPPLICATION: 'OVERAPPLICATION',
  DUPLICATE_RESOURCE: 'DUPLICATE_RESOURCE',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',

  // Fallback
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERR)[keyof typeof ERR];
