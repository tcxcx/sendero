'use client';

import { NavUser } from '@/components/nav-user';

export function NavInboxUser({
  user,
}: {
  user: { name: string; email: string; imageUrl: string };
}) {
  return (
    <NavUser
      user={{
        name: user.name,
        email: user.email,
        avatar: user.imageUrl || '/brand/logo-masters/clean/sendero_icon_vermilion_clean_2048.png',
      }}
    />
  );
}
