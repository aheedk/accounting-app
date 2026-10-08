-- Access by area (docs/specs/2026-10-08-accounts-and-roles-design.md).
-- Payroll holds pay rates and social security numbers, and was open to every
-- staff login. A firm admin can now switch it off for a login. On by default,
-- so nobody loses anything until someone decides they should.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS payroll_access boolean NOT NULL DEFAULT true;
