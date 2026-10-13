-- The company's own phone number, so it can be shown the same consistent way
-- as a vendor's or a customer's (2026-10-10 meeting, item 38). There was no
-- phone field on businesses at all before this.
ALTER TABLE businesses ADD COLUMN phone text;
