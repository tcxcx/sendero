import { UserProfile } from '@clerk/nextjs';

export default function ProfilePage() {
  return (
    <main className="flex justify-center">
      <UserProfile
        appearance={{
          elements: {
            rootBox: 'w-full max-w-4xl',
            cardBox: 'shadow-none border border-border',
          },
        }}
      />
    </main>
  );
}
