import { SenderoSignIn } from '@sendero/auth/components/sign-in';
import { AuthShell } from '@/components/auth-shell';

export default function SignInPage() {
  return (
    <AuthShell
      title="Welcome back."
      description="Sign in with Clerk to return to your tenant workspace, trips, invoices, spend controls, and team settings."
      asideTitle="Buyer workspace"
      asideItems={[
        'Protected routes stay behind Clerk session and organization checks.',
        'Roles control access to billing, spend dashboards, and retry actions.',
        'Wallet setup happens after sign-in, inside tenant onboarding.',
      ]}
    >
      <SenderoSignIn />
    </AuthShell>
  );
}
