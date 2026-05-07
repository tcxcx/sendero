import { redirect } from 'next/navigation';

import { requireSuperadmin } from '@/lib/superadmin';

export default async function RootPage() {
  const result = await requireSuperadmin();
  if (!result.ok) {
    redirect(result.reason === 'unauthenticated' ? '/sign-in' : '/unauthorized');
  }
  redirect('/dashboard/treasury');
}
