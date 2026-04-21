import { SenderoSignUp } from '@sendero/auth/components/sign-up';
import { AuthShell } from '@/components/auth-shell';

export default function SignUpPage() {
  return (
    <AuthShell
      title="Request agent access."
      description="Join the Sendero testnet waitlist. Access opens with Clerk identity, then organization setup, channel adapters, policy configuration, metering, and Arc settlement."
      asideTitle="Private testnet"
      asideItems={[
        'No wallet or passkey setup before Clerk grants access.',
        'Channels, policies, sessions, and billing are configured after the organization exists.',
        'Mainnet access stays gated while production webhooks and settlement mature.',
      ]}
    >
      <SenderoSignUp />
    </AuthShell>
  );
}
