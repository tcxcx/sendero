import { UserDetails } from '@sendero/auth/components/user-details';
import { notFound } from 'next/navigation';

export default function DebugClerkPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Clerk session debug</h1>
      <p className="text-sm text-muted-foreground">
        Live view of the current user, session, organization, and wallet state.
      </p>
      <UserDetails showPointers={true} extraSections={['wallet']} />
    </div>
  );
}
