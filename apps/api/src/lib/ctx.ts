import type { Role } from '@accounting/shared';

export type ServiceCtx = {
  user_id: string;
  firm_id: string;
  business_id: string | null;
  effective_role: Role;
  request_id: string;
  ip_address: string;
  user_agent: string;
};

// Convenience for tests and system-initiated code paths (seed, admin scripts).
export function systemCtx(overrides: Partial<ServiceCtx> & Pick<ServiceCtx, 'firm_id'>): ServiceCtx {
  return {
    user_id: '00000000-0000-0000-0000-000000000000',
    business_id: null,
    effective_role: 'firm_admin',
    request_id: '00000000-0000-0000-0000-000000000000',
    ip_address: '127.0.0.1',
    user_agent: 'system',
    ...overrides,
  };
}
