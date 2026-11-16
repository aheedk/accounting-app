import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import accmaticaLogo from '@/assets/accmatica-logo.png';

// The centered card shared by every page a person reaches signed out: sign
// in, forgot password, reset password, accept an invitation. No sidebar, no
// app chrome — there is no session yet for any of them.
export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center bg-background px-4 py-12">
      <div className="w-full max-w-[420px] space-y-6">
        <div className="flex items-center justify-center gap-2">
          <img src={accmaticaLogo} alt="" className="h-8 w-8 object-contain" />
          <span className="font-display text-xl tracking-tight text-gold">Accmatica</span>
        </div>
        <Card>{children}</Card>
      </div>
    </div>
  );
}
