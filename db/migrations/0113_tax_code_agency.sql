-- Which taxing authority a tax code's collections are owed to, so Sales Tax
-- by Agency can group by it instead of by code. NULL on every code written
-- before this; the report shows those under "Not Specified", the same way
-- Expenses by Vendor already handles a line with no name.
ALTER TABLE tax_codes
  ADD COLUMN IF NOT EXISTS agency text;
