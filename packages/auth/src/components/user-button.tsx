'use client';

import { UserButton } from '@clerk/nextjs';

export function SenderoUserButton(props: { userProfileUrl?: string }) {
  return <UserButton userProfileUrl={props.userProfileUrl ?? '/app/profile'} />;
}
