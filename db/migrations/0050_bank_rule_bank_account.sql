-- Allow a bank rule to be scoped to a specific bank account (NULL = all accounts)
ALTER TABLE bank_transaction_rules
  ADD COLUMN bank_account_id uuid REFERENCES bank_accounts(id);
