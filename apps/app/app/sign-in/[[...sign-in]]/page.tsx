import { SenderoSignIn } from '@sendero/auth/components/sign-in';
import { AuthShell } from '@/components/auth-shell';

export default function SignInPage() {
  return (
    <AuthShell
      title="Welcome back."
      description="Sign in with Clerk to return to your Sendero workspace for traveler sessions, policies, channel adapters, metering, billing, and settlement."
      asideTitle="Agent workspace"
      asideItems={[
        'Protected routes stay behind Clerk session and organization checks.',
        'Organizations map to agencies, companies, operators, and agent clients.',
        'Traveler sessions, policies, channels, and action ledgers stay inside the app.',
      ]}
    >
      <SenderoSignIn />
    </AuthShell>
  );
}
