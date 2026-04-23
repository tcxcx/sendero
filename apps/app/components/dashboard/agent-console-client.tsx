'use client';

import dynamic from 'next/dynamic';

const ClerkSenderoApp = dynamic(
  () => import('@/components/dashboard/clerk-sendero-app').then(mod => mod.ClerkSenderoApp),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[60vh] items-center justify-center p-6 text-xs text-muted-foreground">
        Loading workspace…
      </div>
    ),
  }
);

export function AgentConsoleClient() {
  return (
    <div className="min-h-0 flex-1 w-full bg-background">
      <ClerkSenderoApp />
    </div>
  );
}
