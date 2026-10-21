import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChangePasswordForm } from '@/components/account/ChangePasswordForm';
import { TwoStepSetupForm } from '@/components/account/TwoStepSetupForm';

// What a login does before the app opens to it (security review 2026-10-21):
// choose its own password when the one it signed in with was made by a firm
// admin, and set up the second step when the firm requires it. The API answers
// nothing else until both are done (middleware/auth.ts on the API); each step
// renews the session, which then carries what is left.
export default function AccountSetupPage() {
  const { user, renew, logout } = useAuth();
  const steps = user?.setup_required ?? [];
  const step = steps[0];

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4 py-8">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Finish setting up your login</CardTitle>
          <p className="text-sm text-muted-foreground">
            {user?.email}{steps.length > 1 ? ` · Step 1 of ${steps.length}` : ''}
          </p>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {step === 'password' && (
            <>
              <p>
                The password you signed in with was made by a firm admin, so they know it.
                Choose your own before you go on.
              </p>
              <ChangePasswordForm currentLabel="Password you signed in with" onChanged={renew} />
            </>
          )}
          {step === 'two_step' && (
            <>
              <p>
                Your firm asks everyone to use a second step when signing in: after your password,
                a 6-digit code from an authenticator app on your phone (Google Authenticator,
                Microsoft Authenticator, 1Password and others). A stolen password alone then gets nobody in.
              </p>
              <TwoStepSetupForm onEnabled={renew} canCancel={false} />
            </>
          )}
          <div className="border-t pt-4">
            <Button variant="ghost" className="h-auto p-0 font-normal text-link hover:text-link" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
