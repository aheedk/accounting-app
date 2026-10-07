// The arithmetic of one pay run line. Rates are the statutory ones every
// employer uses; the wage-base cap on Social Security is not applied, so the
// figures are a starting point the user can type over.

export const SOCIAL_SECURITY_RATE = 0.062;
export const MEDICARE_RATE = 0.0145;

export type PayLine = {
  employee_id: string;
  included: boolean;
  hours: string;
  gross: string;
  federal_wh: string;
  state_wh: string;
  fica_employee: string;
  fica_employer: string;
  medicare_employee: string;
  medicare_employer: string;
  other_deductions: string;
};

const num = (value: string) => Number(value) || 0;
const cents = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

export function blankPayLine(employee_id: string): PayLine {
  return {
    employee_id, included: true, hours: '', gross: '',
    federal_wh: '', state_wh: '', fica_employee: '', fica_employer: '',
    medicare_employee: '', medicare_employer: '', other_deductions: '',
  };
}

/** Social Security and Medicare for both sides, worked out from the gross. */
export function withPayrollTaxes(line: PayLine, gross: string): PayLine {
  const g = num(gross);
  const ss = g > 0 ? cents(g * SOCIAL_SECURITY_RATE) : '';
  const medicare = g > 0 ? cents(g * MEDICARE_RATE) : '';
  return { ...line, gross, fica_employee: ss, fica_employer: ss, medicare_employee: medicare, medicare_employer: medicare };
}

/** Gross from hours at the employee's rate, with the taxes that follow from it. */
export function withHours(line: PayLine, hours: string, hourlyRate: number): PayLine {
  const h = num(hours);
  const next = { ...line, hours };
  return h > 0 && hourlyRate > 0 ? withPayrollTaxes(next, cents(h * hourlyRate)) : next;
}

/** What the employee takes home: gross less everything withheld from them. */
export function netPay(line: PayLine): number {
  return num(line.gross) - num(line.federal_wh) - num(line.state_wh)
    - num(line.fica_employee) - num(line.medicare_employee) - num(line.other_deductions);
}

/** What the run costs the employer on top of gross pay. */
export function employerTaxes(line: PayLine): number {
  return num(line.fica_employer) + num(line.medicare_employer);
}

export function payRunTotals(lines: PayLine[]) {
  const included = lines.filter(line => line.included && num(line.gross) > 0);
  return {
    count: included.length,
    gross: included.reduce((sum, line) => sum + num(line.gross), 0),
    net: included.reduce((sum, line) => sum + netPay(line), 0),
    employerTaxes: included.reduce((sum, line) => sum + employerTaxes(line), 0),
    /** A line that withholds more than it pays cannot be right. */
    negativeNet: included.some(line => netPay(line) < 0),
  };
}
