import { ROLE_LABELS } from '@accounting/shared';

// Shared by Setup → Users and its "Edit client access" page: the built-in
// roles, a login's own, and how a role picker's <option value> encodes which
// kind was chosen.

export type Role = 'firm_admin' | 'accountant' | 'staff' | 'viewer' | 'client';
export const ROLES: Role[] = ['firm_admin', 'accountant', 'staff', 'viewer', 'client'];

/** One of the firm's own roles (Setup → Roles, docs/specs/2026-11-09-custom-roles-design.md). */
export type CustomRoleRef = { id: string; name: string };

// A role menu's value: `builtin:staff`, or `custom:<role id>`.
export const builtin = (role: Role) => `builtin:${role}`;
export const custom = (id: string) => `custom:${id}`;
export function roleChoice(value: string): { role: Role } | { custom_role_id: string } {
  return value.startsWith('custom:') ? { custom_role_id: value.slice('custom:'.length) } : { role: value.slice('builtin:'.length) as Role };
}

/** The built-in roles, then the firm's own. */
export function RoleOptions({ roles }: { roles: CustomRoleRef[] }) {
  return (
    <>
      <optgroup label="Built-in roles">
        {ROLES.map(r => <option key={r} value={builtin(r)}>{ROLE_LABELS[r]}</option>)}
      </optgroup>
      {roles.length > 0 && (
        <optgroup label="Your roles">
          {roles.map(r => <option key={r.id} value={custom(r.id)}>{r.name}</option>)}
        </optgroup>
      )}
    </>
  );
}
