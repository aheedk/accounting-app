import { ERR } from '@accounting/shared';
import { BusinessRuleError } from './errors.js';

export class UnbalancedEntryError extends BusinessRuleError {
  constructor(je_id: string, debits: string, credits: string) {
    super(ERR.UNBALANCED_ENTRY,
      `Journal entry ${je_id} is unbalanced (debits=${debits}, credits=${credits})`,
      { journal_entry_id: je_id, debits, credits });
    this.name = 'UnbalancedEntryError';
  }
}

export class ClosedPeriodError extends BusinessRuleError {
  constructor(period_id: string, closed_at?: string) {
    super(ERR.CLOSED_PERIOD,
      `Cannot post into closed period ${period_id}`,
      { period_id, closed_at });
    this.name = 'ClosedPeriodError';
  }
}

export class InvalidStateTransitionError extends BusinessRuleError {
  constructor(entity: string, id: string, from: string, to: string) {
    super(ERR.INVALID_STATE_TRANSITION,
      `Cannot transition ${entity} ${id} from ${from} to ${to}`,
      { entity, id, from, to });
    this.name = 'InvalidStateTransitionError';
  }
}

export class ImmutableRecordError extends BusinessRuleError {
  constructor(entity: string, id: string) {
    super(ERR.IMMUTABLE_RECORD,
      `${entity} ${id} is posted and cannot be mutated`,
      { entity, id });
    this.name = 'ImmutableRecordError';
  }
}

export class PreconditionError extends BusinessRuleError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ERR.PRECONDITION_FAILED, message, details);
    this.name = 'PreconditionError';
  }
}
