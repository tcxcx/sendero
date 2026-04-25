/**
 * Operator-side renderer for `ChannelMessage`.
 *
 * Uses the AI Elements primitives Sendero already has installed under
 * apps/app/components/ai-elements. Returns a single React element per
 * canonical message kind, exhaustively switching on the discriminator
 * so the compiler enforces parity when new kinds land.
 *
 * Composition contract: this renderer ONLY emits the inner content of
 * a Message. Wrapping in a <Message from={role}>...</Message> is the
 * caller's job (the chat surface owns the role mapping).
 */

import type { JSX } from 'react';

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai-elements/sources';

// `@/components/ai-elements/confirmation` and `@/components/ai-elements/task`
// are dropped in alongside but not imported here yet. See the JSDoc on
// ApprovalCard for the prop-shape mismatch that's blocking direct adoption
// of Confirmation, and the `tool_invocation` case below for why Task is
// held until the canonical shape exposes a multi-step orchestration kind.

import type { ChannelMessage, ChannelCta } from './types';

function exhaustive(_: never): never {
  throw new Error('non-exhaustive ChannelMessage kind');
}

/** Render the inner content for a single canonical message. */
export function renderForOperator(msg: ChannelMessage): JSX.Element {
  switch (msg.kind) {
    case 'text':
      return (
        <MessageContent>
          <MessageResponse>{msg.content}</MessageResponse>
        </MessageContent>
      );

    case 'card':
      return (
        <MessageContent>
          <CardBlock
            title={msg.title}
            body={msg.body}
            bullets={msg.bullets}
            imageUrl={msg.imageUrl}
            ctas={msg.ctas}
          />
        </MessageContent>
      );

    case 'tool_invocation':
      // Renders single-call invocations via Tool. The AI Elements `Task`
      // primitive is a richer fit when the agent surfaces a multi-step
      // orchestration (e.g. plan + sub-tools); revisit when the canonical
      // ChannelMessage union grows an orchestration kind.
      return (
        <Tool>
          <ToolHeader
            type={`tool-${msg.toolName}`}
            state={
              msg.status === 'pending'
                ? 'input-streaming'
                : msg.status === 'streaming'
                  ? 'input-streaming'
                  : msg.status === 'error'
                    ? 'output-error'
                    : 'output-available'
            }
          />
          <ToolContent>
            <ToolInput input={msg.input} />
            {msg.errorMessage ? <ToolOutput output={null} errorText={msg.errorMessage} /> : null}
          </ToolContent>
        </Tool>
      );

    case 'tool_result':
      return (
        <Tool defaultOpen>
          <ToolHeader type={`tool-${msg.toolName}`} state="output-available" />
          <ToolContent>
            <ToolOutput
              output={
                msg.share ? (
                  <CardBlock
                    title={msg.share.title}
                    body={msg.share.body}
                    bullets={msg.share.bullets}
                    imageUrl={msg.share.imageUrl}
                    ctas={[
                      ...(msg.share.primaryCta ? [msg.share.primaryCta] : []),
                      ...(msg.share.secondaryCtas ?? []),
                    ]}
                  />
                ) : (
                  <pre className="overflow-x-auto text-xs">{stringify(msg.result)}</pre>
                )
              }
              errorText={undefined}
            />
          </ToolContent>
        </Tool>
      );

    case 'approval_request':
      return (
        <MessageContent>
          <ApprovalCard
            travelerName={msg.subject.travelerName}
            route={msg.subject.route}
            amountUsd={msg.subject.amountUsd}
            expiresAt={msg.subject.expiresAt}
            reason={msg.subject.reason}
            reviewUrl={msg.reviewUrl}
          />
        </MessageContent>
      );

    case 'reasoning':
      return (
        <Reasoning defaultOpen={!msg.collapsedByDefault} duration={msg.durationMs}>
          <ReasoningTrigger />
          <ReasoningContent>{msg.content}</ReasoningContent>
        </Reasoning>
      );

    case 'sources':
      if (msg.items.length === 0) {
        return <MessageContent>{null}</MessageContent>;
      }
      return (
        <MessageContent>
          <Sources>
            <SourcesTrigger count={msg.items.length} />
            <SourcesContent>
              {msg.items.map(s => (
                <Source key={s.url} href={s.url} title={s.title} />
              ))}
            </SourcesContent>
          </Sources>
        </MessageContent>
      );

    default:
      return exhaustive(msg);
  }
}

// ─── helpers ─────────────────────────────────────────────────────────

function stringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

interface CardBlockProps {
  title: string;
  body: string;
  bullets?: string[];
  imageUrl?: string;
  ctas?: ChannelCta[];
}

function CardBlock({ title, body, bullets, imageUrl, ctas }: CardBlockProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
      {imageUrl ? (
        <img src={imageUrl} alt="" className="mb-1 max-h-48 w-full rounded-sm object-cover" />
      ) : null}
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </div>
      <div className="text-sm text-foreground">{body}</div>
      {bullets && bullets.length > 0 ? (
        <ul className="ml-4 list-disc text-xs text-muted-foreground">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : null}
      {ctas && ctas.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {ctas.map((cta, i) => (
            <CtaButton key={i} cta={cta} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CtaButton({ cta }: { cta: ChannelCta }) {
  const isPrimary = cta.emphasis !== 'secondary';
  const cls = isPrimary
    ? 'rounded-sm border border-[color:var(--ink)] bg-[color:var(--ink)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--bg-elev)] transition-opacity hover:opacity-90'
    : 'rounded-sm border border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-[color:var(--ink)] hover:text-foreground';
  if (cta.kind === 'open_link' && cta.href) {
    return (
      <a className={cls} href={cta.href} target="_blank" rel="noreferrer">
        {cta.label}
      </a>
    );
  }
  return (
    <button type="button" className={cls} data-cta-kind={cta.kind} data-cta-value={cta.value ?? ''}>
      {cta.label}
    </button>
  );
}

interface ApprovalCardProps {
  travelerName: string;
  route: string;
  amountUsd: number;
  expiresAt?: string;
  reason?: string;
  reviewUrl?: string;
}

/**
 * Inline approval card. Kept distinct from the AI Elements Confirmation
 * primitive: Confirmation expects a ToolUIPart-shaped `state` plus an
 * `approval` object keyed by id, while ChannelMessageApprovalRequest
 * carries traveler / route / amount / reason. Swap once the canonical
 * shape exposes a confirmation kind that maps id + approved + reason
 * directly.
 */
function ApprovalCard(props: ApprovalCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-[color:var(--accent-amber)] bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--accent-amber)]">
          Approval needed
        </div>
        {props.expiresAt ? (
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            Expires {new Date(props.expiresAt).toUTCString().slice(5, 22)}
          </div>
        ) : null}
      </div>
      <div className="text-sm font-medium text-foreground">{props.travelerName}</div>
      <div className="text-sm text-muted-foreground">{props.route}</div>
      <div className="text-sm font-mono text-foreground">${props.amountUsd.toFixed(2)} USD</div>
      {props.reason ? (
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          Reason: {props.reason.replace(/_/g, ' ')}
        </div>
      ) : null}
      {props.reviewUrl ? (
        <div className="mt-1 flex flex-wrap gap-2">
          <a
            href={props.reviewUrl}
            className="rounded-sm border border-[color:var(--ink)] bg-[color:var(--ink)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--bg-elev)] transition-opacity hover:opacity-90"
          >
            Approve in console
          </a>
        </div>
      ) : null}
    </div>
  );
}
