import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useCanOpen } from '@/lib/roleAccess';

type ReportLink = { to: string; name: string; description: string };
type ReportGroup = { heading: string; reports: ReportLink[] };

// Grouped to mirror QuickBooks' "Standard" reports page categories.
const groups: ReportGroup[] = [
  {
    heading: 'Business overview',
    reports: [
      { to: '/reports/pnl', name: 'Profit and Loss', description: 'Revenue and expenses for a period, with gross profit and net income.' },
      { to: '/reports/pnl-detail', name: 'Profit and Loss Detail', description: 'Every transaction behind the Profit and Loss, under its account.' },
      { to: '/reports/pnl-by-month', name: 'Profit and Loss by Month', description: 'The Profit and Loss with a column for each month, and the total.' },
      { to: '/reports/pnl-quarterly', name: 'Quarterly Profit and Loss Summary', description: 'The Profit and Loss with a column for each quarter of the fiscal year, and the total.' },
      { to: '/reports/pnl-comparison', name: 'Profit and Loss Comparison', description: 'This period against the same period a year earlier, with the change in dollars and percent.' },
      { to: '/reports/pnl-ytd-comparison', name: 'Profit and Loss Year-to-Date Comparison', description: 'The period beside the fiscal year to date.' },
      { to: '/reports/pnl-percent-of-income', name: 'Profit and Loss as % of Total Income', description: 'Each line of the Profit and Loss as a share of total income.' },
      { to: '/reports/pnl-by-customer', name: 'Profit and Loss by Customer', description: 'The Profit and Loss with a column for each customer.' },
      { to: '/reports/balance-sheet', name: 'Balance Sheet', description: 'Assets, liabilities, and equity as of a point in time.' },
      { to: '/reports/balance-sheet-summary', name: 'Balance Sheet Summary', description: 'The Balance Sheet with one line for each account type.' },
      { to: '/reports/balance-sheet-detail', name: 'Balance Sheet Detail', description: 'Each balance sheet account from its beginning balance, through the transactions in the period, to where it ends.' },
      { to: '/reports/balance-sheet-comparison', name: 'Balance Sheet Comparison', description: 'The Balance Sheet against the same date a year earlier, with the change in dollars and percent.' },
      { to: '/reports/statement-of-cash-flows', name: 'Statement of Cash Flows', description: 'The change in cash for a period, explained as operating, investing and financing activities.' },
      { to: '/reports/financial-planning', name: 'Budget vs. Actuals', description: 'A budget, and how what was posted compares with it.' },
      { to: '/setup/activity', name: 'Audit Log', description: 'Who added, changed or deleted what, and when.' },
    ],
  },
  {
    heading: 'For my accountant',
    reports: [
      { to: '/reports/general-ledger', name: 'General Ledger', description: 'Detailed transactions, opening balances, and running balances grouped by account.' },
      { to: '/reports/account-list', name: 'Account List', description: 'Every account in the chart, grouped by type, with its detail type and balance.' },
      { to: '/reports/journal', name: 'Journal', description: 'Every transaction in the period with all of its debits and credits.' },
      { to: '/reports/transaction-list-by-date', name: 'Transaction List by Date', description: 'One line for each transaction in the period, by date.' },
      { to: '/reports/transaction-list-with-splits', name: 'Transaction List with Splits', description: 'Each transaction in the period with every account it touches.' },
      { to: '/reports/transaction-detail-by-account', name: 'Transaction Detail by Account', description: 'The transactions in the period under each account, the balance running from zero.' },
      { to: '/reports/recent-transactions', name: 'Recent Transactions', description: 'Transactions entered in the last four days, or between the dates you pick, by type.' },
      { to: '/reports/trial-balance', name: 'Trial Balance', description: 'Debit and credit balances for every account as of a chosen date.' },
      { to: '/reports/adjusted-trial-balance', name: 'Adjusted Trial Balance', description: 'Each balance before the period\'s adjusting entries, the adjustments, and after.' },
      { to: '/reports/cash-flow', name: 'Cash Activity by Account', description: 'Every movement in one bank account over a period, with a running balance.' },
      { to: '/accounting/recurring', name: 'Recurring Template List', description: 'Every recurring transaction template, how often it runs and when it runs next.' },
      { to: '/reports/reconciliation', name: 'Reconciliation Reports', description: 'Every completed reconciliation, fixed as it was the day it was finished — the balances, the cleared transactions, and a PDF copy.' },
    ],
  },
  {
    heading: 'Who owes you',
    reports: [
      { to: '/reports/aging', name: 'Accounts Receivable Aging Summary', description: 'Outstanding customer invoices bucketed by days past due, less unapplied payments and credits.' },
      { to: '/reports/customer-balances', name: 'Customer Balance Summary', description: 'Each customer\'s current open balance, with no bucket breakdown.' },
      { to: '/reports/open-invoices', name: 'Open Invoices', description: 'Every invoice still carrying a balance, one row each, due soonest first.' },
      { to: '/reports/ar-aging-detail', name: 'A/R Aging Detail', description: 'Open invoices grouped under their aging bucket, one row each.' },
      { to: '/reports/customer-balance-detail', name: 'Customer Balance Detail', description: 'Open invoices grouped under each customer, one row each.' },
      { to: '/reports/collections', name: 'Collections Report', description: 'Invoices past due, under each customer with their phone number, and how many days late.' },
      { to: '/reports/invoice-list', name: 'Invoice List', description: 'Every invoice dated in the period, with its status and what is still owed.' },
      { to: '/reports/invoices-and-payments', name: 'Invoices and Received Payments', description: 'Each invoice dated in the period, with the payments and credits applied to it, and what is still owed.' },
    ],
  },
  {
    heading: 'Sales and customers',
    reports: [
      { to: '/reports/sales-by-customer', name: 'Sales by Customer Summary', description: 'Income from invoices, credit memos and deposits, for each customer.' },
      { to: '/reports/sales-by-customer-detail', name: 'Sales by Customer Detail', description: 'The sales behind Sales by Customer Summary, line by line, under each customer.' },
      { to: '/reports/income-by-customer', name: 'Income by Customer Summary', description: 'Each customer\'s income, the costs that name them, and what is left.' },
      { to: '/reports/transaction-list-by-customer', name: 'Transaction List by Customer', description: 'Every transaction in the period under the customer it names.' },
      { to: '/reports/deposit-detail', name: 'Deposit Detail', description: 'What went into each bank account, with where it came from under it.' },
      { to: '/reports/estimates-by-customer', name: 'Estimates by Customer', description: 'The estimates dated in the period, under each customer, with their status.' },
      { to: '/reports/customer-contact-list', name: 'Customer Contact List', description: 'Each active customer\'s phone numbers, email, contact name and addresses.' },
      { to: '/reports/product-service-list', name: 'Product/Service List', description: 'Every active item with its price, cost and quantity on hand.' },
      { to: '/reports/inventory-valuation-summary', name: 'Inventory Valuation Summary', description: 'Each item\'s quantity on hand as of a date, what it cost, and the average cost.' },
      { to: '/reports/inventory-valuation-detail', name: 'Inventory Valuation Detail', description: 'Each item\'s stock from the start of the period, through every movement, with the quantity and value running.' },
      { to: '/reports/physical-inventory-worksheet', name: 'Physical Inventory Worksheet', description: 'Each item with the quantity on hand and on order, and a blank column to count into.' },
    ],
  },
  {
    heading: 'What you owe',
    reports: [
      { to: '/reports/ap-aging', name: 'Accounts Payable Aging Summary', description: 'Unpaid vendor bills bucketed by days past due, less unused vendor credits.' },
      { to: '/reports/vendor-balances', name: 'Vendor Balance Summary', description: 'Each vendor\'s current open balance, with no bucket breakdown.' },
      { to: '/reports/unpaid-bills', name: 'Unpaid Bills', description: 'Every bill still carrying a balance, one row each, due soonest first.' },
      { to: '/reports/ap-aging-detail', name: 'A/P Aging Detail', description: 'Unpaid bills grouped under their aging bucket, one row each.' },
      { to: '/reports/vendor-balance-detail', name: 'Vendor Balance Detail', description: 'Unpaid bills grouped under each vendor, one row each.' },
      { to: '/reports/bill-payment-list', name: 'Bill Payment List', description: 'Every bill payment in the period, under the account it was paid from.' },
    ],
  },
  {
    heading: 'Expenses and vendors',
    reports: [
      { to: '/reports/expenses-by-vendor', name: 'Expenses by Vendor Summary', description: 'Everything spent in the period, for each vendor or payee.' },
      { to: '/reports/purchases-by-vendor-detail', name: 'Purchases by Vendor Detail', description: 'What was bought from each vendor, line by line, less vendor credits.' },
      { to: '/reports/transaction-list-by-vendor', name: 'Transaction List by Vendor', description: 'Every transaction in the period under the vendor it names.' },
      { to: '/reports/check-detail', name: 'Check Detail', description: 'Every check written in the period, with what it paid for under it.' },
      { to: '/reports/open-purchase-orders', name: 'Open Purchase Order List', description: 'Purchase orders not yet received, closed or voided, under each vendor.' },
      { to: '/reports/open-purchase-order-detail', name: 'Open Purchase Order Detail', description: 'Each line of the purchase orders not yet received, under each vendor.' },
      { to: '/reports/vendor-contact-list', name: 'Vendor Contact List', description: 'Each active vendor\'s phone numbers, email, contact name, address and account number.' },
      { to: '/reports/1099', name: '1099 Transaction Detail Report', description: 'Annual payments to 1099 vendors, grouped by vendor and tax ID.' },
    ],
  },
  {
    heading: 'Sales tax',
    reports: [
      { to: '/reports/sales-tax-liability', name: 'Sales Tax Liability Report', description: 'The tax charged on the period\'s invoices under each tax code, with the sales it was charged on.' },
    ],
  },
];

export default function StandardReportsPage() {
  // A report the role cannot open is left off, as in the sidebar and search.
  const canOpen = useCanOpen();
  const visible = groups
    .map(group => ({ ...group, reports: group.reports.filter(r => canOpen(r.to)) }))
    .filter(group => group.reports.length > 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Standard Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Built-in financial reports generated from the current ledger.
        </p>
      </div>

      {visible.map(group => (
        <section key={group.heading} className="space-y-1">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{group.heading}</h2>
          <div className="divide-y rounded-xl border bg-card shadow-card">
            {group.reports.map(r => (
              <Link
                key={r.to}
                to={r.to}
                className="group flex items-center justify-between gap-4 px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/40"
              >
                <div>
                  <div className="font-medium text-link">{r.name}</div>
                  <div className="text-sm text-muted-foreground">{r.description}</div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
