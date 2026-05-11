'use client';

/**
 * Workflow-terminal visibility toggle.
 *
 * Reusable atom shared by:
 *   - The footer `TweaksToggle` popover (existing entry point).
 *   - The `WorkflowLog` col-head row (one-click hide from the panel
 *     itself; bring back via the footer Tweaks panel).
 *
 * Backed by `useSendero({ showWorkflow, setShowWorkflow })`. Visual
 * matches the `tweak-group` / `tw-switch` styles defined in
 * `apps/app/app/globals.css` so both surfaces look identical.
 */

import { useSendero } from '../store';

export interface WorkflowVisibilityToggleProps {
  /**
   * `'stacked'` (default) — label above the switch+state, used in the
   * footer Tweaks popover where space is generous.
   * `'inline'` — label, switch, and state on a single row, used inside
   * the WorkflowLog header where height is at a premium.
   */
  layout?: 'stacked' | 'inline';
}

export function WorkflowVisibilityToggle({ layout = 'stacked' }: WorkflowVisibilityToggleProps) {
  const showWorkflow = useSendero(s => s.showWorkflow);
  const setShowWorkflow = useSendero(s => s.setShowWorkflow);

  if (layout === 'inline') {
    return (
      <div className="tweak-toggle" style={{ gap: 6 }}>
        <span className="tk-label" style={{ marginRight: 2 }}>
          Workflow
        </span>
        <button
          type="button"
          aria-label={showWorkflow ? 'Hide workflow terminal' : 'Show workflow terminal'}
          aria-pressed={showWorkflow}
          className={`tw-switch ${showWorkflow ? 'on' : ''}`}
          onClick={() => setShowWorkflow(!showWorkflow)}
          style={{ background: 'transparent' }}
        >
          <div className="knob" />
        </button>
        <span style={{ minWidth: 38 }}>{showWorkflow ? 'Visible' : 'Hidden'}</span>
      </div>
    );
  }

  return (
    <div className="tweak-group">
      <span className="tk-label">Workflow terminal</span>
      <div className="tweak-toggle">
        <button
          type="button"
          aria-label={showWorkflow ? 'Hide workflow terminal' : 'Show workflow terminal'}
          aria-pressed={showWorkflow}
          className={`tw-switch ${showWorkflow ? 'on' : ''}`}
          onClick={() => setShowWorkflow(!showWorkflow)}
          style={{ background: 'transparent' }}
        >
          <div className="knob" />
        </button>
        <span>{showWorkflow ? 'Visible' : 'Hidden'}</span>
      </div>
    </div>
  );
}
