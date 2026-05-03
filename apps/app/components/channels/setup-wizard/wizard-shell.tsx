'use client';

/**
 * Two-pane channel setup wizard.
 *
 * Mirrors `route-artboards.jsx::WhatsappB` / `SlackB`. Left rail:
 * vertical step ladder with vermillion-glow on the active dot and
 * sea-green ✓ on completed dots. Right pane: per-step form rendered
 * by the channel's pane map. Footer: Back · autosaved · Save & exit ·
 * Continue.
 *
 * The shell is generic and visual-only — bind it to any WorkflowRun
 * whose pause steps carry `{ promptId, stepIndex, totalSteps,
 * helpText, … }` payloads. Kapso plumbing lives in the pane
 * implementations and `/api/channels/wizard/resume`; nothing here
 * touches the integration directly.
 */

import { useEffect, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Check, ChevronLeft, Loader2 } from 'lucide-react';

import type {
  WizardPaneRenderer,
  WizardResolution,
  WizardRunSnapshot,
  WizardStepDef,
} from './types';

interface WizardShellProps {
  channel: 'whatsapp' | 'slack';
  /** Headline above the rail. */
  headline: string;
  /** One-sentence subline shown under the headline. */
  subline: React.ReactNode;
  /** Help link target (e.g. /docs/channels/whatsapp). */
  helpHref: string;
  helpLabel: string;
  /** Live snapshot from the server. Re-fetched after each resume. */
  initialRun: WizardRunSnapshot;
  /** Pane renderer keyed by `promptId`. */
  panes: Record<string, WizardPaneRenderer>;
  /** Where to send the operator after the run completes. */
  doneHref: string;
}

export function ChannelSetupWizard(props: WizardShellProps) {
  const router = useRouter();
  const [run, setRun] = useState<WizardRunSnapshot>(props.initialRun);
  const [resolution, setResolution] = useState<WizardResolution | null>(null);
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setRun(props.initialRun);
    setResolution(null);
    setErrorMsg(null);
  }, [props.initialRun]);

  const isComplete = run.status === 'completed';
  const isFailed = run.status === 'failed';
  const activePane = run.activeStep?.promptId ? props.panes[run.activeStep.promptId] : null;
  const activeStepIndex = run.activeStep
    ? run.steps.findIndex(step => step.id === run.activeStep?.id)
    : -1;
  const previousStep =
    activeStepIndex > 0
      ? [...run.steps.slice(0, activeStepIndex)].reverse().find(step => step.status === 'completed')
      : null;

  const jumpToStep = (stepId: string) => {
    if (!run.activeStep || stepId === run.activeStep.id) return;
    setErrorMsg(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/channels/wizard/jump', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: run.sessionId, stepId }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (body.error === 'wizard_session_not_found') {
            window.location.reload();
            return;
          }
          setErrorMsg(body.error ?? `HTTP ${res.status}`);
          return;
        }
        const next = (await res.json()) as WizardRunSnapshot;
        setRun(next);
        setResolution(null);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Network error');
      }
    });
  };

  const submitContinue = () => {
    if (!run.activeStep) return;
    setErrorMsg(null);
    const payload = resolution ?? {};
    startTransition(async () => {
      try {
        const res = await fetch('/api/channels/wizard/resume', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: run.sessionId, resolution: payload }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (body.error === 'wizard_session_not_found') {
            window.location.reload();
            return;
          }
          setErrorMsg(body.error ?? `HTTP ${res.status}`);
          return;
        }
        const next = (await res.json()) as WizardRunSnapshot;
        setRun(next);
        setResolution(null);
        setSavedAt(Date.now());
        if (next.status === 'completed') {
          router.refresh();
          router.push(props.doneHref);
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Network error');
      }
    });
  };

  const exit = () => router.push(props.doneHref);

  return (
    <div
      style={{
        padding: '0 20px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        flex: 1,
        minHeight: 0,
        width: '100%',
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '320px 1fr',
          gap: 0,
        }}
      >
        <StepRail
          headline={props.headline}
          subline={props.subline}
          steps={run.steps}
          activeStepId={run.activeStep?.id ?? null}
          pending={pending}
          onStepClick={jumpToStep}
          helpHref={props.helpHref}
          helpLabel={props.helpLabel}
        />
        <div
          style={{
            paddingLeft: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            minHeight: 0,
            minWidth: 0,
            overflowY: 'auto',
            overflowX: 'auto',
          }}
        >
          {isComplete ? (
            <CompletionPanel onExit={exit} />
          ) : isFailed ? (
            <FailurePanel error={run.error} onRestart={exit} />
          ) : run.activeStep && activePane ? (
            <ActivePane
              step={run.activeStep}
              payload={run.activePayload ?? {}}
              scratchpad={run.scratchpad}
              pending={pending}
              renderer={activePane}
              setResolution={setResolution}
            />
          ) : (
            <PendingPanel />
          )}
          {!isComplete && !isFailed ? (
            <Footer
              pending={pending}
              resolutionReady={resolution !== null}
              onBack={() => {
                if (previousStep) {
                  jumpToStep(previousStep.id);
                } else {
                  router.back();
                }
              }}
              onSaveExit={exit}
              onContinue={submitContinue}
              continueLabel={
                run.activeStep?.id === 'await_oauth_callback'
                  ? 'I have installed it'
                  : run.activeStep?.id === 'go_live'
                    ? 'Activate'
                    : 'Continue'
              }
              errorMsg={errorMsg}
              savedAt={savedAt}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StepRail({
  headline,
  subline,
  steps,
  activeStepId,
  pending,
  onStepClick,
  helpHref,
  helpLabel,
}: {
  headline: string;
  subline: React.ReactNode;
  steps: WizardStepDef[];
  activeStepId: string | null;
  pending: boolean;
  onStepClick: (stepId: string) => void;
  helpHref: string;
  helpLabel: string;
}) {
  return (
    <aside
      style={{
        borderRight: '1px solid var(--hairline-color)',
        paddingRight: 28,
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        minWidth: 0,
      }}
    >
      <div className="t-meta">Connect</div>
      <h2 className="t-h2" style={{ marginTop: 8 }}>
        {headline}
      </h2>
      <p className="t-body ink-70" style={{ marginTop: 10, lineHeight: 1.55, fontSize: 13 }}>
        {subline}
      </p>
      <hr aria-hidden style={hairlineSoft} />
      <ol
        style={{
          display: 'flex',
          flexDirection: 'column',
          margin: 0,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {steps.map((step, i) => (
          <StepRailItem
            key={step.id}
            step={step}
            isActive={step.id === activeStepId}
            isLast={i === steps.length - 1}
            disabled={pending}
            onClick={onStepClick}
          />
        ))}
      </ol>
      <hr aria-hidden style={{ ...hairlineSoft, margin: '4px 0 18px' }} />
      <div className="t-meta">Need help</div>
      <div className="t-body ink-70" style={{ marginTop: 6, lineHeight: 1.55, fontSize: 13 }}>
        <a
          href={helpHref}
          style={{
            color: 'var(--vermillion)',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          {helpLabel}
        </a>
      </div>
    </aside>
  );
}

function StepRailItem({
  step,
  isActive,
  isLast,
  disabled,
  onClick,
}: {
  step: WizardStepDef;
  isActive: boolean;
  isLast: boolean;
  disabled: boolean;
  onClick: (stepId: string) => void;
}) {
  const done = step.status === 'completed';
  const canJump = done && !isActive && !disabled;
  const dotBg = done ? '#2EA876' : isActive ? 'var(--vermillion)' : 'var(--surface-base)';
  const dotColor = done || isActive ? '#fdfbf7' : 'rgba(31,42,68,0.5)';
  const dotShadow = isActive
    ? '0 0 0 4px var(--tint-vermillion-soft)'
    : 'inset 0 0 0 1px var(--hairline-color)';
  const labelColor = isActive || done ? 'var(--midnight)' : 'rgba(31,42,68,0.6)';
  return (
    <li
      style={{
        display: 'flex',
        gap: 14,
        paddingBottom: 18,
        position: 'relative',
        margin: 0,
      }}
    >
      {!isLast ? (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 13,
            top: 30,
            bottom: 0,
            width: 2,
            background: done ? '#2EA876' : 'var(--hairline-color)',
          }}
        />
      ) : null}
      <button
        type="button"
        disabled={!canJump}
        onClick={() => onClick(step.id)}
        style={{
          appearance: 'none',
          border: 0,
          padding: 0,
          textAlign: 'left',
          background: 'transparent',
          cursor: canJump ? 'pointer' : 'default',
          opacity: disabled && done ? 0.7 : 1,
          display: 'flex',
          gap: 14,
          minWidth: 0,
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            flexShrink: 0,
            position: 'relative',
            zIndex: 1,
            background: dotBg,
            color: dotColor,
            display: 'grid',
            placeItems: 'center',
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 600,
            boxShadow: dotShadow,
          }}
        >
          {done ? <Check className="h-3.5 w-3.5" /> : step.index}
        </span>
        <div style={{ paddingTop: 3, minWidth: 0 }}>
          <div
            className="t-body"
            style={{
              fontWeight: isActive ? 600 : 500,
              color: labelColor,
              fontSize: 13,
            }}
          >
            {step.label}
          </div>
          {step.sublabel ? (
            <div className="t-mono ink-60" style={{ marginTop: 2, fontSize: 11 }}>
              {step.sublabel}
            </div>
          ) : null}
        </div>
      </button>
    </li>
  );
}

function ActivePane({
  step,
  payload,
  scratchpad,
  pending,
  renderer,
  setResolution,
}: {
  step: WizardStepDef;
  payload: Record<string, unknown>;
  scratchpad: Record<string, unknown>;
  pending: boolean;
  renderer: WizardPaneRenderer;
  setResolution: (resolution: WizardResolution | null) => void;
}) {
  const stepIndex = (payload.stepIndex as number | undefined) ?? step.index;
  const totalSteps = (payload.totalSteps as number | undefined) ?? null;
  const helpText = (payload.helpText as string | undefined) ?? null;
  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 18, minHeight: 0 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="t-meta">
          Step {stepIndex}
          {totalSteps ? ` of ${totalSteps}` : ''}
        </div>
        <h1 className="t-h1" style={{ marginTop: 6 }}>
          {step.label}
        </h1>
        {helpText ? (
          <p className="t-body-lg ink-70" style={{ marginTop: 6, maxWidth: '58ch', fontSize: 14 }}>
            {helpText}
          </p>
        ) : null}
      </header>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <PaneSlot
          renderer={renderer}
          stepId={step.id}
          payload={payload}
          scratchpad={scratchpad}
          pending={pending}
          setResolution={setResolution}
        />
      </div>
    </div>
  );
}

/**
 * Mount the active pane through React.createElement (rather than a plain
 * function call) and key it on stepId so hook order stays stable as the
 * operator advances through the wizard. Without the key, React would
 * try to reuse the same component instance across distinct panes and
 * throw "change in the order of Hooks" when their hook signatures
 * differ.
 */
function PaneSlot({
  renderer: Pane,
  stepId,
  payload,
  scratchpad,
  pending,
  setResolution,
}: {
  renderer: WizardPaneRenderer;
  stepId: string;
  payload: Record<string, unknown>;
  scratchpad: Record<string, unknown>;
  pending: boolean;
  setResolution: (resolution: WizardResolution | null) => void;
}) {
  return (
    <Pane
      key={stepId}
      payload={payload}
      scratchpad={scratchpad}
      pending={pending}
      setResolution={setResolution}
    />
  );
}

function Footer({
  pending,
  resolutionReady,
  onBack,
  onSaveExit,
  onContinue,
  continueLabel,
  errorMsg,
  savedAt,
}: {
  pending: boolean;
  resolutionReady: boolean;
  onBack: () => void;
  onSaveExit: () => void;
  onContinue: () => void;
  continueLabel: string;
  errorMsg: string | null;
  savedAt: number | null;
}) {
  return (
    <div
      style={{
        marginTop: 6,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        borderTop: '1px solid var(--hairline-color-soft)',
        paddingTop: 12,
      }}
    >
      {errorMsg ? (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--tint-vermillion-soft)',
            color: 'var(--vermillion)',
            fontFamily: 'var(--font-mono-x)',
            fontSize: 11,
            borderRadius: 6,
          }}
        >
          {errorMsg}
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} style={ghostBtnStyle}>
          <ChevronLeft className="h-3 w-3" /> Back
        </button>
        {savedAt ? (
          <span className="t-mono ink-60" style={{ fontSize: 10.5 }}>
            autosaved · {Math.max(1, Math.round((Date.now() - savedAt) / 1000))}s ago
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onSaveExit} style={ghostBtnStyle}>
          Save & exit
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={pending || !resolutionReady}
          style={{
            ...primaryBtnStyle,
            opacity: pending || !resolutionReady ? 0.5 : 1,
            cursor: pending || !resolutionReady ? 'not-allowed' : 'pointer',
          }}
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {continueLabel}
        </button>
      </div>
    </div>
  );
}

function CompletionPanel({ onExit }: { onExit: () => void }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        textAlign: 'center',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          background: '#2EA876',
          color: '#fdfbf7',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Check className="h-7 w-7" />
      </span>
      <h2 className="t-h2">You are connected.</h2>
      <p className="t-body ink-70" style={{ maxWidth: '46ch', fontSize: 14, lineHeight: 1.55 }}>
        Sendero will route trip events here from now on. The connected status panel shows live
        traffic.
      </p>
      <button type="button" onClick={onExit} style={primaryBtnStyle}>
        Open channel page
      </button>
    </div>
  );
}

function FailurePanel({
  error,
  onRestart,
}: {
  error: WizardRunSnapshot['error'];
  onRestart: () => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        textAlign: 'center',
      }}
    >
      <h2 className="t-h2" style={{ color: 'var(--vermillion)' }}>
        Something stalled.
      </h2>
      <p className="t-body ink-70" style={{ maxWidth: '60ch', fontSize: 14, lineHeight: 1.55 }}>
        {error?.message ?? 'The workflow did not complete. Restart the wizard or contact support.'}
      </p>
      <button type="button" onClick={onRestart} style={ghostBtnStyle}>
        Back to channel
      </button>
    </div>
  );
}

function PendingPanel() {
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
      <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'rgba(31,42,68,0.55)' }} />
    </div>
  );
}

// ── styles ─────────────────────────────────────────────────────

const primaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 18px',
  background: 'var(--vermillion)',
  color: '#fdfbf7',
  border: 0,
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'var(--font-mono-x)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const ghostBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 14px',
  background: 'transparent',
  color: 'var(--midnight)',
  border: 0,
  boxShadow: 'inset 0 0 0 1px var(--hairline-color)',
  borderRadius: 8,
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--font-mono-x)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const hairlineSoft: React.CSSProperties = {
  border: 0,
  height: 1,
  background: 'var(--hairline-color-soft)',
  margin: '18px 0',
};
