-- Record how an expense was paid. Existing rows cannot be inferred safely,
-- so they retain the explicit legacy fallback value "other".
ALTER TABLE expense_transactions
  ADD COLUMN payment_method payment_method NOT NULL DEFAULT 'other';
