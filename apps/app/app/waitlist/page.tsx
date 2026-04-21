import { AuthShell } from '@/components/auth-shell';
import { WaitlistCard } from '@/components/waitlist-card';

export default function WaitlistPage() {
  return (
    <AuthShell
      title="Join the Sendero agent network."
      description="Request private testnet access for persistent travel agents across WhatsApp, web, Slack, Teams, and MCP. We open tenant setup, channel adapters, policies, and Arc settlement from inside the protected app."
      asideTitle="Private testnet"
      asideItems={[
        'One access flow: Clerk identity first, tenant setup and channels second.',
        'Duffel search, policy checks, metering, billing, and settlement stay behind protected routes.',
        'Mainnet launch notifications go to approved operators, agencies, companies, and agent clients.',
      ]}
    >
      <WaitlistCard />
    </AuthShell>
  );
}
