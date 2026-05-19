-- Slice 14: expand customers table to match the QBO-style new-customer form.
-- All new columns are nullable so existing rows stay valid.

ALTER TABLE customers
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
  ADD COLUMN shipping_address   jsonb,
  ADD COLUMN shipping_same_as_billing boolean NOT NULL DEFAULT true,
  ADD COLUMN notes              text,
  ADD COLUMN primary_payment_method text,
  ADD COLUMN sales_form_delivery text,
  ADD COLUMN invoice_language   text NOT NULL DEFAULT 'English',
  ADD COLUMN credit_limit       numeric(19,4),
  ADD COLUMN customer_type      text,
  ADD COLUMN tax_exemption_details text,
  ADD COLUMN opening_balance    numeric(19,4),
  ADD COLUMN opening_balance_as_of date;
