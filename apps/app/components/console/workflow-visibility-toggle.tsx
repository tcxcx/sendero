'use client';

/**
 * Console right-panel display toggle.
 *
 * Reusable atom shared by:
 *   - The footer `TweaksToggle` popover (existing entry point).
 *   - The `WorkflowLog` col-head row (one-click hide from the panel
 *     itself; bring back via the footer Tweaks panel).
 *
 * Backed by `useSendero({ consoleRightPanelMode })`. Visual
 * matches the `tweak-group` / `tw-switch` styles defined in
 * `apps/app/app/globals.css` so both surfaces look identical.
 */

import type { ReactNode } from 'react';

import { useSendero, type ConsoleRightPanelMode } from '../store';

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
  const mode = useSendero(s => s.consoleRightPanelMode);
  const setMode = useSendero(s => s.setConsoleRightPanelMode);

  if (layout === 'inline') {
    return (
      <div className="tweak-toggle" style={{ gap: 6 }}>
        <span className="tk-label" style={{ marginRight: 2 }}>
          Panel
        </span>
        <PanelChoice mode="pulse" active={mode === 'pulse'} setMode={setMode}>
          Pulse
        </PanelChoice>
        <PanelChoice mode="workflow" active={mode === 'workflow'} setMode={setMode}>
          Workflow
        </PanelChoice>
        <PanelChoice mode="hidden" active={mode === 'hidden'} setMode={setMode}>
          Off
        </PanelChoice>
      </div>
    );
  }

  return (
    <div className="tweak-group">
      <span className="tk-label">Right panel</span>
      <div className="tweak-toggle" role="radiogroup" aria-label="Console right panel">
        <PanelChoice mode="pulse" active={mode === 'pulse'} setMode={setMode}>
          Pulse
        </PanelChoice>
        <PanelChoice mode="workflow" active={mode === 'workflow'} setMode={setMode}>
          Workflow
        </PanelChoice>
        <PanelChoice mode="hidden" active={mode === 'hidden'} setMode={setMode}>
          Off
        </PanelChoice>
      </div>
    </div>
  );
}

function PanelChoice({
  mode,
  active,
  setMode,
  children,
}: {
  mode: ConsoleRightPanelMode;
  active: boolean;
  setMode: (mode: ConsoleRightPanelMode) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className={`tw-choice ${active ? 'on' : ''}`}
      onClick={() => setMode(mode)}
    >
      {children}
    </button>
  );
}
