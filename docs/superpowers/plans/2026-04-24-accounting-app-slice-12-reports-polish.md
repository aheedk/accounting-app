# Slice 12 — Reports Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Replace 5 Reports ComingSoon stubs (Custom Reports, Management Reports, Performance Center, Financial Planning, Spreadsheet Sync) with real read-mostly features.

**Architecture:**
- **Custom Reports:** new `custom_report_definitions` table (name, owner_user_id, definition jsonb). UI is a builder. Run renders a table + CSV export.
- **Management Reports:** no new tables — fixed KPI dashboard computed live from JE lines.
- **Performance Center:** trend view of the same KPIs as Management Reports — 12-month line charts. Reuses computation, swaps render.
- **Financial Planning (Budgets):** new `budgets` + `budget_lines` tables. Budget vs Actual variance report.
- **Spreadsheet Sync:** CSV export hub for trial balance, JE lines, AR aging, AP aging, custom reports, budget vs actual.

**Tech Stack:** No new deps. (Skip charting library — use simple inline SVG line charts or even a CSV export of trends if charting is too much.)

---

## Locked decisions

1. **No charting library.** Trends are rendered as a simple inline SVG line graph or as a sparkline-like ascii table. If a heavier polish is wanted later, add `recharts` in a follow-up.
2. **Custom Reports definition JSON shape:**
```json
{
  "account_ids": ["uuid", "..."],
  "date_range": { "from": "2026-01-01", "to": "2026-03-31" },
  "group_by": "account" | "month" | "cost_center" | "customer" | "vendor",
  "columns": ["debit", "credit", "net"]
}
```
3. **Management KPIs:** revenue (sum of revenue accounts last N months), gross margin %, AR days outstanding, AP days outstanding, current ratio, expense breakdown by top-10 expense accounts.
4. **Budgets:** monthly granularity per CoA account. `budgets.fiscal_year` int. `budget_lines` rows: `(budget_id, account_id, month_offset 0-11, amount)`. Variance = monthly budget vs sum-of-actuals from JE lines.
5. **CSV export streams** the response — no in-memory accumulation for big reports.
6. **Plan-impl sync.**

---

## Phase A — Infra + DB

### Task 1: Migration `0041_custom_report_definitions.sql`

```sql
CREATE TABLE custom_report_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_crd_business ON custom_report_definitions(business_id);
CREATE TRIGGER custom_report_definitions_updated_at BEFORE UPDATE ON custom_report_definitions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Commit: `feat(db): custom_report_definitions table`.

### Task 2: Migration `0042_budgets.sql`

```sql
CREATE TYPE budget_status AS ENUM ('draft', 'active', 'archived');

CREATE TABLE budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  fiscal_year int NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2100),
  status budget_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  CONSTRAINT budgets_unique UNIQUE (business_id, fiscal_year, name)
);
CREATE INDEX idx_budgets_business ON budgets(business_id);
CREATE TRIGGER budgets_updated_at BEFORE UPDATE ON budgets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Commit: `feat(db): budgets table`.

### Task 3: Migration `0043_budget_lines.sql`

```sql
CREATE TABLE budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  month_offset int NOT NULL CHECK (month_offset BETWEEN 0 AND 11),
  amount numeric(19,4) NOT NULL DEFAULT 0,
  CONSTRAINT bl_unique UNIQUE (budget_id, account_id, month_offset)
);
CREATE INDEX idx_bl_budget ON budget_lines(budget_id);
CREATE INDEX idx_bl_account ON budget_lines(account_id);
```

Commit: `feat(db): budget_lines table`.

### Task 4: DB types + audit + schemas + factories + truncateAll

Append types for `CustomReportDefinitionsTable`, `BudgetsTable`, `BudgetLinesTable`. Add to DB.

Audit actions:
```ts
CUSTOM_REPORT_CREATE: 'custom_report.create',
CUSTOM_REPORT_UPDATE: 'custom_report.update',
CUSTOM_REPORT_DELETE: 'custom_report.delete',
BUDGET_CREATE: 'budget.create',
BUDGET_UPDATE: 'budget.update',
BUDGET_DELETE: 'budget.delete',
CSV_EXPORT: 'csv.export',
```

Zod schemas:
- `customReport.ts`: create/update with `definition` jsonb shape.
- `budget.ts`: create (`name, fiscal_year`); update (`status`); `setBudgetLineSchema` for upserting individual cell amounts.

Factory helpers: `makeBudget`, `makeCustomReport`.

`truncateAll` prepend: `'budget_lines', 'budgets', 'custom_report_definitions'`.

Commit: `feat(shared,api): slice 12 audit, schemas, factories, types, truncateAll`.

---

## Phase B — Services (parallel)

### Task 5: `customReportService` (TDD, 2 tests)
- `create`, `update`, `delete`, `list`, `get`.
- `runReport(db, business_id, definition)` — executes the JSON definition against `journal_entry_lines` and returns rows.
- Tests: create + roundtrip; runReport returns expected sums.

### Task 6: `managementReportService` (TDD, 1 test)
Read-only. Returns:
```ts
{
  revenue_by_month: Array<{ month: string; amount: string }>,    // YYYY-MM
  gross_margin_pct: string,
  ar_days_outstanding: string,
  ap_days_outstanding: string,
  current_ratio: string,
  expense_breakdown: Array<{ account_id; account_name; amount }>,
}
```

### Task 7: `performanceReportService` (TDD, 1 test)
Returns 12-month trend of revenue, gross margin, expense total. Each as `{ month: 'YYYY-MM', value: string }[]`.

### Task 8: `budgetService` (TDD, 2 tests)
- `createBudget`, `updateBudget` (status transitions), `setBudgetLine(budget_id, account_id, month_offset, amount)` — upsert single cell.
- `getBudgetWithLines(db, business_id, id)` — full grid.
- `getVarianceReport(db, business_id, budget_id)` — per account per month: budget, actual, variance, variance_pct.
- Tests: create + setBudgetLine upsert; varianceReport with no actuals returns zeros.

### Task 9: `csvExportService` (TDD, 1 test)
Generic CSV serializer + per-report exporter. Returns `{ filename, content_type: 'text/csv', body: Buffer }`.

Tests: trial balance export contains header + one row per CoA account.

---

## Phase C — Routes (parallel)

### Task 10: `customReports.ts` route
GET list, POST create, PATCH update, DELETE, POST `/:id/run` (returns rows + CSV-download link).

### Task 11: `managementReports.ts` + `performanceReports.ts` routes
Two GET endpoints.

### Task 12: `budgets.ts` route
CRUD + `/budgets/:id/lines` PATCH + `/budgets/:id/variance` GET.

### Task 13: `csvExports.ts` route
GET `/businesses/:bizId/csv-exports/:report?from=&to=&...` — returns CSV with appropriate Content-Disposition.

Wire all in app.ts.

---

## Phase D — Web (parallel)

### Task 14: `CustomReportsPage`
Saved-defs list + builder modal + run-and-show-table.

### Task 15: `ManagementReportsPage`
KPI cards grid.

### Task 16: `PerformanceCenterPage`
12-month trends as inline SVG sparklines or simple HTML table.

### Task 17: `FinancialPlanningPage`
Budget list, then per-budget editor — table of CoA × 12 months with editable cells.

### Task 18: `SpreadsheetSyncPage`
List of available exports as download buttons.

### Task 19 (SOLO): Wire 5 routes in App.tsx.

---

## Phase E — Merge + push

Standard. No env-var prereqs. Migrations 0041-0043 auto-run.

---

## Definition of Done

- 5 ComingSoon stubs in `/reports/*` replaced.
- Migrations 0041-0043 applied.
- ~7 new tests (slice 11 baseline 141 → ≥148).
- A custom report can be created, saved, run, and exported as CSV.
- A budget can be created, lines edited, and variance report viewed.
