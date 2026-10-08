-- A view-only role, for a reviewer or an auditor: reads everything a staff
-- login reads and changes nothing (docs/specs/2026-10-08-accounts-and-roles-design.md).
-- It ranks between client and staff; the ranking lives in packages/shared/src/roles.ts.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'viewer';
