-- =====================================================================
-- Auto-coding for invoice/bill line items.
--
-- A bank transaction has one vendor and one account. An invoice has one
-- vendor and MANY lines that belong in different accounts -- copy paper to
-- Office Supplies, a standing desk to Furniture and Fixtures, delivery to
-- Shipping. So a learned rule for an invoice line must be keyed on the line
-- as well as the vendor.
--
-- line_key is '' for bank-transaction rules (the whole transaction) and a
-- normalized line description for invoice-line rules. NOT NULL with a default
-- keeps the existing partial unique indexes usable as plain column lists.
-- =====================================================================

ALTER TABLE account_coding_memory
  ADD COLUMN IF NOT EXISTS line_key text NOT NULL DEFAULT '';

DROP INDEX IF EXISTS account_coding_memory_scoped_key;
DROP INDEX IF EXISTS account_coding_memory_global_key;

CREATE UNIQUE INDEX account_coding_memory_scoped_key
  ON account_coding_memory (business_id, normalized_vendor, direction, bank_account_id, line_key)
  WHERE bank_account_id IS NOT NULL;

CREATE UNIQUE INDEX account_coding_memory_global_key
  ON account_coding_memory (business_id, normalized_vendor, direction, line_key)
  WHERE bank_account_id IS NULL;

-- --------------------------------------------------------------------
-- Capitalization threshold.
--
-- Above this amount a long-lived tangible item is capitalized as a fixed
-- asset instead of expensed. $2,500 matches the IRS de minimis safe harbor
-- for taxpayers without an applicable financial statement; firms with audited
-- statements may elect $5,000, and smaller firms often set it lower, so it is
-- per-business rather than hard-coded.
-- --------------------------------------------------------------------
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS capitalization_threshold numeric(19,4) NOT NULL DEFAULT 2500;
