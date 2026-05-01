import { auth, currentUser } from '@clerk/nextjs/server';
import type { TripPresence } from '@sendero/collaboration/rooms';

export async function buildInitialPresence(input: {
  userId: string;
  focusedSection: TripPresence['focusedSection'];
  tripId?: string | null;
  focusLabel?: string | null;
}): Promise<TripPresence> {
  const { has } = await auth();
  const clerkUser = await currentUser();
  const displayName =
    clerkUser?.fullName ||
    clerkUser?.firstName ||
    clerkUser?.username ||
    clerkUser?.primaryEmailAddress?.emailAddress ||
    'Operator';

  return {
    userId: input.userId,
    displayName,
    avatarUrl: clerkUser?.imageUrl ?? null,
    role: has({ role: 'org:admin' })
      ? 'admin'
      : has({ role: 'org:finance' })
        ? 'finance'
        : 'member',
    cursorX: null,
    cursorY: null,
    tripId: input.tripId ?? null,
    focusedSection: input.focusedSection,
    focusLabel: input.focusLabel ?? null,
  };
}
