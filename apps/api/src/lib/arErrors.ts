import { ERR } from '@accounting/shared';
import { BusinessRuleError } from './errors.js';

export class OverApplicationError extends BusinessRuleError {
  constructor(
    kind: 'payment' | 'invoice' | 'credit_memo' | 'bill' | 'bill_payment' | 'vendor_credit',
    id: string,
    attempted: string,
    available: string,
  ) {
    super(ERR.OVERAPPLICATION,
      `Cannot apply ${attempted}: ${kind} ${id} has only ${available} available`,
      { kind, id, attempted, available });
    this.name = 'OverApplicationError';
  }
}

export class InvoiceHasApplicationsError extends BusinessRuleError {
  constructor(invoice_id: string, application_count: number) {
    super(ERR.PRECONDITION_FAILED,
      `Invoice ${invoice_id} has ${application_count} applied payment(s); unapply before voiding`,
      { invoice_id, application_count });
    this.name = 'InvoiceHasApplicationsError';
  }
}

export class PaymentHasApplicationsError extends BusinessRuleError {
  constructor(payment_id: string, application_count: number) {
    super(ERR.PRECONDITION_FAILED,
      `Payment ${payment_id} has ${application_count} active application(s); unapply before voiding`,
      { payment_id, application_count });
    this.name = 'PaymentHasApplicationsError';
  }
}
