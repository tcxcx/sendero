import { AuthShell } from '@/components/auth-shell';
import { WaitlistCard } from '@/components/waitlist-card';

export default function WaitlistPage() {
  return (
    <AuthShell
      title="Join the Sendero testnet."
      description="Request access to the Clerk-managed preview. We will open tenant setup, roles, wallet provisioning, and mainnet migration paths from inside the protected app."
      asideTitle="Mainnet launch"
      asideItems={[
        'One access flow: Clerk identity first, tenant setup second.',
        'Travel operations, billing, and settlement stay behind protected routes.',
        'You will be notified when production access is ready for your team.',
      ]}
    >
      <WaitlistCard />
    </AuthShell>
  );
}
