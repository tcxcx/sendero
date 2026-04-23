'use client';

/**
 * TripThreadComposer — channel-aware composer for the trip inbox.
 *
 * The operator can:
 *   (a) ask the AI agent for help (the agent can run the full tool suite
 *       against this trip's context) — `mode = 'agent'`
 *   (b) draft a reply that goes to the traveler's channel —
 *       `mode = 'human'`, `isInternal = false`
 *   (c) write an internal note visible only to operators + the agent —
 *       `mode = 'human'`, `isInternal = true`
 *
 * The AI agent and human operator collaborate in the same thread. Every
 * message carries an author attribution and a channel badge. Internal
 * notes never leave the workspace; traveler-facing replies are the ones
 * that get broadcast through the channel adapter.
 *
 * Motion: property-specific transitions ≤ 200ms. No scale-from-zero.
 */

import { useState } from 'react';

import { ArrowRightIcon, BotIcon, EyeOffIcon, SendIcon, UserIcon } from 'lucide-react';

import { ChannelBadge, type ChannelKindSlug } from '@/components/inbox/channel-badge';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';

type ComposerMode = 'agent' | 'human';

export interface TripThreadComposerSubmit {
  text: string;
  mode: ComposerMode;
  channel: ChannelKindSlug;
  isInternal: boolean;
}

export function TripThreadComposer({
  defaultChannel = 'web',
  disabled = false,
  onSubmit,
}: {
  defaultChannel?: ChannelKindSlug;
  disabled?: boolean;
  onSubmit: (message: TripThreadComposerSubmit) => void | Promise<void>;
}) {
  const [mode, setMode] = useState<ComposerMode>('agent');
  const [channel, setChannel] = useState<ChannelKindSlug>(defaultChannel);
  const [isInternal, setIsInternal] = useState(false);

  const effectiveChannel: ChannelKindSlug = isInternal ? 'internal' : channel;
  const primaryLabel =
    mode === 'agent'
      ? 'Ask agent'
      : isInternal
        ? 'Save note'
        : `Reply via ${CHANNEL_LABELS[channel]}`;
  const primaryHint =
    mode === 'agent'
      ? 'Agent drafts in this thread. Nothing is sent to the traveler yet.'
      : isInternal
        ? 'Internal note — visible only to operators and the agent.'
        : `Reply is delivered to the traveler on ${CHANNEL_LABELS[channel]}.`;

  return (
    <div className="border-t border-border bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b border-dashed border-border px-4 py-2">
        <ModeToggle mode={mode} onChange={setMode} />
        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
        <ChannelSelect
          value={channel}
          onChange={setChannel}
          disabled={isInternal || mode === 'agent'}
        />
        <label
          className={
            'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors duration-150 ease-out ' +
            (isInternal
              ? 'border-[color:var(--ink)] bg-[color:var(--bg-soft)] text-[color:var(--ink)]'
              : 'border-border text-muted-foreground hover:border-[color:var(--ink)]')
          }
        >
          <EyeOffIcon className="size-3" />
          <input
            type="checkbox"
            className="sr-only"
            checked={isInternal}
            onChange={e => setIsInternal(e.target.checked)}
          />
          Internal
        </label>
        <span className="ml-auto inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <ChannelBadge channel={effectiveChannel} size="xs" />
          <span>→</span>
          <span>
            {mode === 'agent' ? 'agent first' : isInternal ? 'operators only' : 'traveler'}
          </span>
        </span>
      </div>
      <PromptInput
        className="border-none bg-transparent"
        onSubmit={(message, event) => {
          event.preventDefault();
          const text = message.text.trim();
          if (!text || disabled) return;
          void onSubmit({ text, mode, channel: effectiveChannel, isInternal });
        }}
      >
        <PromptInputBody>
          <PromptInputTextarea
            placeholder={composerPlaceholder(mode, isInternal, channel)}
            disabled={disabled}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {primaryHint}
            </span>
          </PromptInputTools>
          <PromptInputSubmit className="composer-send" disabled={disabled} status={undefined}>
            {primaryLabel}
            {mode === 'agent' ? (
              <ArrowRightIcon className="ml-1 size-3.5" />
            ) : (
              <SendIcon className="ml-1 size-3.5" />
            )}
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: ComposerMode;
  onChange: (next: ComposerMode) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-border bg-[color:var(--bg-soft)] p-0.5 text-[11px] font-mono uppercase tracking-[0.12em]">
      <button
        type="button"
        onClick={() => onChange('agent')}
        aria-pressed={mode === 'agent'}
        className={
          'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 transition-colors duration-150 ease-out ' +
          (mode === 'agent'
            ? 'bg-[color:var(--ink)] text-[color:var(--panel)]'
            : 'text-muted-foreground hover:text-[color:var(--ink)]')
        }
      >
        <BotIcon className="size-3" /> Agent
      </button>
      <button
        type="button"
        onClick={() => onChange('human')}
        aria-pressed={mode === 'human'}
        className={
          'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 transition-colors duration-150 ease-out ' +
          (mode === 'human'
            ? 'bg-[color:var(--ink)] text-[color:var(--panel)]'
            : 'text-muted-foreground hover:text-[color:var(--ink)]')
        }
      >
        <UserIcon className="size-3" /> Human
      </button>
    </div>
  );
}

function ChannelSelect({
  value,
  onChange,
  disabled,
}: {
  value: ChannelKindSlug;
  onChange: (next: ChannelKindSlug) => void;
  disabled?: boolean;
}) {
  const options: ChannelKindSlug[] = ['web', 'whatsapp', 'slack', 'email'];
  return (
    <label className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
      Channel
      <select
        value={value}
        onChange={e => onChange(e.target.value as ChannelKindSlug)}
        disabled={disabled}
        className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-[color:var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.map(opt => (
          <option key={opt} value={opt}>
            {CHANNEL_LABELS[opt]}
          </option>
        ))}
      </select>
    </label>
  );
}

function composerPlaceholder(mode: ComposerMode, isInternal: boolean, channel: ChannelKindSlug) {
  if (mode === 'agent') {
    return 'Ask the Sendero agent to search, book, or explain something on this trip…';
  }
  if (isInternal) return 'Internal note — operators and agent only…';
  return `Reply to traveler via ${CHANNEL_LABELS[channel]}…`;
}

const CHANNEL_LABELS: Record<ChannelKindSlug, string> = {
  whatsapp: 'WhatsApp',
  slack: 'Slack',
  email: 'Email',
  web: 'Web',
  mcp: 'MCP',
  internal: 'Internal',
};
