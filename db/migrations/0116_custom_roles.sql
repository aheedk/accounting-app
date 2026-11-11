-- The firm's own roles: a name and a level for each area of the books.
-- Spec: docs/specs/2026-11-09-custom-roles-design.md
--
-- `permissions` maps each area (packages/shared/src/permissions.ts) to a level:
-- none, view, enter, post or full. The API reads it on every request in a company.

CREATE TABLE IF NOT EXISTS firm_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     uuid NOT NULL REFERENCES firms(id),
  name        text NOT NULL,
  description text,
  permissions jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One name per firm, whatever its case.
CREATE UNIQUE INDEX IF NOT EXISTS firm_roles_firm_name ON firm_roles (firm_id, lower(name));

DROP TRIGGER IF EXISTS firm_roles_updated_at ON firm_roles;
CREATE TRIGGER firm_roles_updated_at
  BEFORE UPDATE ON firm_roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A login's firm-wide custom role. Such a login is stored as staff, so it is
-- never a firm admin (and never a client): outside a company, staff is what it is.
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id uuid REFERENCES firm_roles(id);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_custom_role_is_staff;
ALTER TABLE users ADD CONSTRAINT users_custom_role_is_staff
  CHECK (custom_role_id IS NULL OR role = 'staff');
CREATE INDEX IF NOT EXISTS idx_users_custom_role ON users (custom_role_id) WHERE custom_role_id IS NOT NULL;

-- A custom role for one company, instead of a built-in one there.
ALTER TABLE user_business_access ADD COLUMN IF NOT EXISTS custom_role_id uuid REFERENCES firm_roles(id);
ALTER TABLE user_business_access DROP CONSTRAINT IF EXISTS uba_one_role;
ALTER TABLE user_business_access ADD CONSTRAINT uba_one_role
  CHECK (role_override IS NULL OR custom_role_id IS NULL);
CREATE INDEX IF NOT EXISTS idx_uba_custom_role ON user_business_access (custom_role_id) WHERE custom_role_id IS NOT NULL;
