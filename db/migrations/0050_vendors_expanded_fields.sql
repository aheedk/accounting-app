-- Expand vendors table to match the QBO-style new-vendor form
-- (mirrors 0049_customers_expanded_fields for the AP side).
-- All new columns are nullable so existing rows stay valid.
-- Bill Pay ACH info (bank account / routing) is intentionally omitted:
-- vendor bank credentials need their own encrypted subsystem.

ALTER TABLE vendors
  ADD COLUMN company_name       text,
  ADD COLUMN title              text,
  ADD COLUMN first_name         text,
  ADD COLUMN middle_name        text,
  ADD COLUMN last_name          text,
  ADD COLUMN suffix             text,
  ADD COLUMN email_cc           text,
  ADD COLUMN email_bcc          text,
  ADD COLUMN mobile             text,
  ADD COLUMN fax                text,
  ADD COLUMN other_phone        text,
  ADD COLUMN website            text,
  ADD COLUMN name_on_checks     text,
  ADD COLUMN notes              text,
  ADD COLUMN account_number     text,
  ADD COLUMN default_expense_account_id uuid REFERENCES chart_of_accounts(id),
  ADD COLUMN opening_balance    numeric(19,4),
  ADD COLUMN opening_balance_as_of date;
