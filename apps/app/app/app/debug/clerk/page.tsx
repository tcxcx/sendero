import { notFound } from 'next/navigation';
import { UserDetails } from '@sendero/auth/components/user-details';

export default function DebugClerkPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <main className="p-8">
      <h1 className="text-lg font-semibold mb-4">Clerk session debug</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Live view of the current user + session + organization. Dev-only; 404s in production.
      </p>
      <UserDetails showPointers={true} extraSections={['wallet']} />
    </main>
  );
}
