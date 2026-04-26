/**
 * Shared types for the channel setup wizard (WhatsApp + Slack).
 *
 * The wizard renders a `WizardRunSnapshot` returned by the server. Per-
 * step panes are pure components keyed on `promptId`. The shell handles
 * navigation, status pills, and the resume POST.
 */

export type WizardStepStatus = 'pending' | 'active' | 'completed' | 'failed';

export interface WizardStepDef {
  /** Workflow step id (matches `WorkflowDef.steps[i].id`). */
  id: string;
  /** Friendly label shown in the left rail. */
  label: string;
  /** Sub-label below the main label, optional. */
  sublabel?: string;
  /** Renderer key — picks a pane component out of the channel's pane map. */
  promptId?: string;
  status: WizardStepStatus;
  /** Position in the visible step rail (1-based). */
  index: number;
}

export interface WizardRunSnapshot {
  /**
   * Session.id when status='paused' (the row holding the active pause's
   * threadContext). Empty string on terminal — the wizard shell renders
   * the completion / failure panel instead of POSTing to resume.
   */
  sessionId: string;
  workflowId: string;
  workflowLabel: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  scratchpad: Record<string, unknown>;
  /** All steps in their canonical order. */
  steps: WizardStepDef[];
  /** When status='paused', the step the wizard renders the form for. */
  activeStep?: WizardStepDef;
  /** Pause `payload` minted by the workflow def — passed straight to the pane. */
  activePayload?: Record<string, unknown>;
  error?: { stepId: string; message: string };
}

/** Resolution shape POSTed back to /api/workflows/resume as `{ sessionId, resolution }`. */
export type WizardResolution = Record<string, unknown>;

export interface WizardPaneProps<P = Record<string, unknown>> {
  /** Workflow scratchpad — read prior step outputs, e.g. `reservation.e164`. */
  scratchpad: Record<string, unknown>;
  /** The pause's `payload` from the workflow def. */
  payload: P;
  /** Disabled while the resume request is in-flight. */
  pending: boolean;
  /** Set the resolution that will be POSTed when the operator clicks Continue. */
  setResolution: (resolution: WizardResolution | null) => void;
}

/**
 * Pane renderer is a React component (not a plain function call) so each
 * pane gets its own hook scope. Using `React.ComponentType` lets the
 * shell mount/unmount panes as the active step changes, which keeps
 * React's "rules of hooks" happy across navigation.
 */
export type WizardPaneRenderer = React.ComponentType<WizardPaneProps>;
