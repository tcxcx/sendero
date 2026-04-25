'use client';

/**
 * Two-pane channel setup wizard.
 *
 * Left pane: ordered step rail with status pills (active/done/pending).
 * Right pane: per-step form rendered by the channel's pane map.
 * Footer:    Back · Save & exit · Continue → POST to resume endpoint.
 *
 * The shell is generic — bind it to any WorkflowRun whose pause steps
 * carry `{ promptId, stepIndex, totalSteps, helpText, … }` payloads.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, ChevronLeft, Loader2 } from 'lucide-react';

import type {
  WizardPaneRenderer,
  WizardResolution,
  WizardRunSnapshot,
  WizardStepDef,
} from './types';

interface WizardShellProps {
  channel: 'whatsapp' | 'slack';
  /** "5 steps · about 5 minutes" headline above the rail. */
  headline: string;
  /** One-sentence subline shown under the headline. */
  sublineHtml: string;
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

const RAIL_TITLE_CLASSES =
  'font-serif text-[clamp(28px,3.4vw,38px)] leading-[1.05] tracking-[-0.01em] text-[color:var(--ink)]';
const RAIL_SUB_CLASSES = 'text-sm leading-snug text-[color:var(--text-dim)]';
const PILL_FONT_CLASSES =
  'font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-faint)]';

export function ChannelSetupWizard(props: WizardShellProps) {
  const router = useRouter();
  const [run, setRun] = useState<WizardRunSnapshot>(props.initialRun);
  const [resolution, setResolution] = useState<WizardResolution | null>(null);
  const [pending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isComplete = run.status === 'completed';
  const isFailed = run.status === 'failed';
  const activePane = run.activeStep?.promptId ? props.panes[run.activeStep.promptId] : null;

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
          setErrorMsg(body.error ?? `HTTP ${res.status}`);
          return;
        }
        const next = (await res.json()) as WizardRunSnapshot;
        setRun(next);
        setResolution(null);
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
    <div className="flex w-full max-w-[1080px] flex-col gap-3">
      <Breadcrumb channel={props.channel} runStatus={run.status} />
      <section className="flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[color:color-mix(in_oklab,var(--accent-rose)_45%,transparent)] bg-[color:var(--surface-raised)] shadow-[var(--shadow-md)]">
        <div className="grid grid-cols-1 gap-0 lg:grid-cols-[300px_1fr]">
          <StepRail
            headline={props.headline}
            sublineHtml={props.sublineHtml}
            steps={run.steps}
            activeStepId={run.activeStep?.id ?? null}
            helpHref={props.helpHref}
            helpLabel={props.helpLabel}
          />
          <div className="flex min-h-[460px] flex-col bg-[color:color-mix(in_oklab,var(--surface)_82%,white_18%)] p-7">
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
                onBack={() => router.back()}
                onSaveExit={exit}
                onContinue={submitContinue}
                continueLabel={
                  run.activeStep?.id === 'await_oauth_callback' ? 'I have installed it' : 'Continue'
                }
                errorMsg={errorMsg}
              />
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function Breadcrumb({
  channel,
  runStatus,
}: {
  channel: 'whatsapp' | 'slack';
  runStatus: WizardRunSnapshot['status'];
}) {
  return (
    <div className="flex items-center justify-between px-1">
      <span className={PILL_FONT_CLASSES}>
        Channels · {channel === 'whatsapp' ? 'WhatsApp' : 'Slack'} · Connect
      </span>
      <span className={PILL_FONT_CLASSES}>Setup wizard · v2 · {runStatus}</span>
    </div>
  );
}

function StepRail({
  headline,
  sublineHtml,
  steps,
  activeStepId,
  helpHref,
  helpLabel,
}: {
  headline: string;
  sublineHtml: string;
  steps: WizardStepDef[];
  activeStepId: string | null;
  helpHref: string;
  helpLabel: string;
}) {
  return (
    <aside className="flex flex-col gap-6 border-r border-[color:color-mix(in_oklab,var(--ink)_10%,transparent)] p-6">
      <div className="flex flex-col gap-2">
        <h2 className={RAIL_TITLE_CLASSES}>{headline}</h2>
        <p className={RAIL_SUB_CLASSES} dangerouslySetInnerHTML={{ __html: sublineHtml }} />
      </div>
      <ol className="flex flex-col gap-1.5">
        {steps.map(step => (
          <StepRailItem key={step.id} step={step} isActive={step.id === activeStepId} />
        ))}
      </ol>
      <div className="mt-auto flex flex-col gap-1.5 pt-2">
        <span className={PILL_FONT_CLASSES}>Need help?</span>
        <a
          href={helpHref}
          className="text-sm text-[color:var(--text)] underline-offset-2 hover:underline"
        >
          {helpLabel}
        </a>
      </div>
    </aside>
  );
}

function StepRailItem({ step, isActive }: { step: WizardStepDef; isActive: boolean }) {
  const tone =
    step.status === 'completed'
      ? 'border-[color:var(--accent-green,#16a34a)] bg-[color:var(--accent-green,#16a34a)] text-white'
      : isActive
        ? 'border-[color:var(--accent-rose)] bg-[color:var(--accent-rose)] text-white'
        : 'border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] bg-transparent text-[color:var(--text-dim)]';
  const labelTone =
    step.status === 'completed'
      ? 'text-[color:var(--text-dim)]'
      : isActive
        ? 'text-[color:var(--ink)]'
        : 'text-[color:var(--text)]';
  return (
    <li
      className={
        'flex items-start gap-3 rounded-md px-2 py-1.5 transition-colors ' +
        (isActive ? 'bg-[color:color-mix(in_oklab,var(--accent-rose)_8%,transparent)]' : '')
      }
    >
      <span
        className={
          'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] tracking-[0.04em] transition-colors ' +
          tone
        }
      >
        {step.status === 'completed' ? <Check className="h-3.5 w-3.5" /> : step.index}
      </span>
      <div className="flex flex-col gap-0">
        <span className={'text-[13px] font-medium leading-snug ' + labelTone}>{step.label}</span>
        {step.sublabel ? (
          <span className="text-[11px] leading-tight text-[color:var(--text-faint)]">
            {step.sublabel}
          </span>
        ) : null}
      </div>
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
    <div className="flex flex-1 flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <span className={PILL_FONT_CLASSES}>
          Step {stepIndex}
          {totalSteps ? ` of ${totalSteps}` : ''}
        </span>
        <h3 className="font-serif text-[clamp(24px,2.4vw,30px)] leading-[1.1] tracking-[-0.01em] text-[color:var(--ink)]">
          {step.label}
        </h3>
        {helpText ? (
          <p className="max-w-[60ch] text-sm leading-relaxed text-[color:var(--text-dim)]">
            {helpText}
          </p>
        ) : null}
      </header>
      <div className="flex flex-1 flex-col">
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
}: {
  pending: boolean;
  resolutionReady: boolean;
  onBack: () => void;
  onSaveExit: () => void;
  onContinue: () => void;
  continueLabel: string;
  errorMsg: string | null;
}) {
  return (
    <div className="mt-6 flex flex-col gap-2 border-t border-[color:color-mix(in_oklab,var(--ink)_10%,transparent)] pt-4">
      {errorMsg ? (
        <div className="rounded-md border border-[color:var(--accent-rose)] bg-[color:color-mix(in_oklab,var(--accent-rose)_8%,transparent)] px-3 py-2 text-xs text-[color:var(--accent-rose)]">
          {errorMsg}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--text-dim)] transition-colors hover:text-[color:var(--ink)]"
        >
          <ChevronLeft className="h-3 w-3" />
          Back
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSaveExit}
            className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--text)] transition-colors hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]"
          >
            Save & exit
          </button>
          <button
            type="button"
            onClick={onContinue}
            disabled={pending || !resolutionReady}
            className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--accent-rose)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {continueLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function CompletionPanel({ onExit }: { onExit: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--accent-green,#16a34a)] text-white">
        <Check className="h-6 w-6" />
      </span>
      <h3 className="font-serif text-[clamp(22px,2.4vw,28px)] leading-tight tracking-[-0.01em] text-[color:var(--ink)]">
        You are connected.
      </h3>
      <p className="max-w-[42ch] text-sm leading-relaxed text-[color:var(--text-dim)]">
        Sendero will route trip events here from now on. The connected status panel shows live
        traffic.
      </p>
      <button
        type="button"
        onClick={onExit}
        className="mt-3 rounded-md bg-[color:var(--ink)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-90"
      >
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
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <h3 className="font-serif text-[clamp(22px,2.4vw,28px)] leading-tight tracking-[-0.01em] text-[color:var(--accent-rose)]">
        Something stalled.
      </h3>
      <p className="max-w-[60ch] text-sm leading-relaxed text-[color:var(--text-dim)]">
        {error?.message ?? 'The workflow did not complete. Restart the wizard or contact support.'}
      </p>
      <button
        type="button"
        onClick={onRestart}
        className="mt-3 rounded-md border border-[color:var(--ink)] bg-transparent px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink)] transition-colors hover:bg-[color:var(--ink)] hover:text-white"
      >
        Back to channel
      </button>
    </div>
  );
}

function PendingPanel() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-[color:var(--text-dim)]" />
    </div>
  );
}
