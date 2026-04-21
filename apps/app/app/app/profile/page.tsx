import { UserDetails } from '@sendero/auth/components/user-details';

export default function ProfilePage() {
  return (
    <main className="p-8">
      <UserDetails showPointers={false} extraSections={['wallet']} />
    </main>
  );
}
