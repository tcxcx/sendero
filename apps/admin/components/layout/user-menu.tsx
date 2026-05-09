'use client';

import * as React from 'react';
import { UserButton } from '@clerk/nextjs';

export function UserMenu() {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        aria-hidden="true"
        className="h-8 w-8 rounded-full border bg-[color:var(--color-muted)]"
      />
    );
  }

  return <UserButton />;
}
