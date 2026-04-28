import { ERR } from '@accounting/shared';
import { BusinessRuleError } from './errors.js';

export class BillHasApplicationsError extends BusinessRuleError {
  constructor(bill_id: string, application_count: number) {
    super(ERR.PRECONDITION_FAILED,
      `Bill ${bill_id} has ${application_count} applied payment(s); unapply before voiding`,
      { bill_id, application_count });
    this.name = 'BillHasApplicationsError';
  }
}

export class BillPaymentHasApplicationsError extends BusinessRuleError {
  constructor(bill_payment_id: string, application_count: number) {
    super(ERR.PRECONDITION_FAILED,
      `Bill payment ${bill_payment_id} has ${application_count} active application(s); unapply before voiding`,
      { bill_payment_id, application_count });
    this.name = 'BillPaymentHasApplicationsError';
  }
}
