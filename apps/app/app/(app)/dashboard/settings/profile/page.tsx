import { UserProfile } from '@clerk/nextjs';

export default function ProfilePage() {
  return (
    <main className="flex justify-center">
      <UserProfile
        appearance={{
          elements: {
            rootBox: 'w-full max-w-4xl',
            cardBox: 'shadow-[var(--shadow-md)] rounded-[var(--radius-lg)]',
          },
        }}
      />
    </main>
  );
}
