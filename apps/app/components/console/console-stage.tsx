'use client';

/**
 * ConsoleStage — wraps `<Stage />` for the `@stage` parallel-routes
 * slot.
 *
 * Both inner components read directly from the `useSendero` Zustand
 * store (populated by the layout-level `ConsoleChatHost`). This wrapper
 * exists so the slot can render without per-tool-call props plumbing
 * The WorkflowLog lives in the right console panel now, where it can
 * be interchanged with Workspace Pulse from the Tweaks menu.
 */

import { Stage } from '@/components/stage';

export function ConsoleStage() {
  return (
    <div
      className="meta-inbox-stage"
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Stage />
    </div>
  );
}
