import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const { sessionClaims } = await auth();
  const orgMeta = (sessionClaims?.org_metadata ?? {}) as { onboardingComplete?: boolean };
  if (orgMeta.onboardingComplete === true) redirect('/dashboard');
  return <>{children}</>;
}
