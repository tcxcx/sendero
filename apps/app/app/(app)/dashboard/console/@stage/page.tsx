/**
 * Phase B-γ — `@stage` parallel-routes slot.
 *
 * Renders the booking-artifacts column (offer cards / hold card /
 * hotels / settlement panel) and, when the operator's `showWorkflow`
 * preference is true, the WorkflowLog tool ticker below it.
 *
 * Both Stage and WorkflowLog read from the `useSendero` Zustand store
 * — they don't need props or a server fetch. The store is populated
 * by `useChatStoreSync` running inside the layout-level
 * `ConsoleChatHost` whenever a tool call streams through useChat.
 *
 * Lives as its own slot so the conversation column can re-render on
 * every useChat token without dragging Stage or WorkflowLog through
 * the same render path. Phase B-γ rationale: codebase maintainability
 * + future feature velocity (per the plan's outside-voice round-2
 * reasoning), not user-visible streaming latency.
 */

import { ConsoleStage } from '@/components/console/console-stage';

export const dynamic = 'force-dynamic';

export default function StageSlot() {
  return <ConsoleStage />;
}
