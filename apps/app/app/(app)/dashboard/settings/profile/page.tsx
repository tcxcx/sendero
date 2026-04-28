import { UserProfile } from '@clerk/nextjs';

export default function ProfilePage() {
  return (
    <div className="flex justify-center">
      <UserProfile
        appearance={{
          elements: {
            rootBox: 'w-full max-w-4xl',
          },
        }}
      />
    </div>
  );
}
