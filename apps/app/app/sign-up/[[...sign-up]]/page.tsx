import { SenderoSignUp } from '@sendero/auth/components/sign-up';
import { AuthShell } from '@/components/auth-shell';

export default function SignUpPage() {
  return (
    <AuthShell
      title="Request testnet access."
      description="Join the Clerk-managed waitlist. When access opens, Sendero will guide organization setup, roles, and wallet provisioning after account creation."
      asideTitle="Arc Testnet"
      asideItems={[
        'No passkey prompt before Clerk grants access.',
        'Team invites and organization profile live in Clerk-managed settings.',
        'Mainnet access stays gated while we finish production readiness.',
      ]}
    >
      <SenderoSignUp />
    </AuthShell>
  );
}
