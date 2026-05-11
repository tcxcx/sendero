import { redirect } from 'next/navigation';

import { pickHomeRoute } from '@/lib/access';

/**
 * Root redirect. Lands the caller on the highest-priority home for
 * their roles per `HOME_BY_ROLE`. Middleware has already enforced
 * "is signed in and has at least one platform role"; this just picks
 * the destination.
 */
export default async function RootPage() {
  const home = await pickHomeRoute();
  if (home === null) redirect('/unauthorized');
  redirect(home);
}
