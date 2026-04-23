'use client';

import dynamic from 'next/dynamic';

const SenderoApp = dynamic(() => import('@/components/sendero-app').then(mod => mod.SenderoApp), {
  ssr: false,
});

export function AgentConsoleClient() {
  return (
    <div className="min-h-0 flex-1 w-full bg-background">
      <SenderoApp />
    </div>
  );
}
