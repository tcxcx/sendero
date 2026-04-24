import { AgentConsoleClient } from '@/components/dashboard/agent-console-client';

export default function AgentConsolePage() {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col bg-background">
      <AgentConsoleClient />
    </div>
  );
}
