'use client';

/**
 * ConsoleStage — wraps `<Stage />` and conditionally `<WorkflowLog />`
 * for the `@stage` parallel-routes slot.
 *
 * Both inner components read directly from the `useSendero` Zustand
 * store (populated by the layout-level `ConsoleChatHost`). This wrapper
 * exists so the slot can render without per-tool-call props plumbing
 * and so the WorkflowLog visibility toggle can be driven by the
 * `showWorkflow` user preference (also in the store).
 */

import { Stage } from '@/components/stage';
import { useSendero } from '@/components/store';
import { WorkflowLog } from '@/components/workflow-log';

export function ConsoleStage() {
  const showWorkflow = useSendero(s => s.showWorkflow);
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
      {showWorkflow ? (
        <div
          style={{
            borderTop: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 14%, transparent)',
            maxHeight: '40%',
            overflow: 'auto',
          }}
        >
          <WorkflowLog />
        </div>
      ) : null}
    </div>
  );
}
