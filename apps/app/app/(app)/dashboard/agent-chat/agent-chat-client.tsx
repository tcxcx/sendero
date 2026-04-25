'use client';

/**
 * AgentChatClient — operator-facing test bench for the canonical
 * channel-render layer. Composes AI Elements primitives via the
 * `renderForOperator` adapter, so every message displayed here is
 * also a valid `ChannelMessage` that other channel renderers will
 * emit faithfully on WhatsApp / Slack / web.
 *
 * Backend: POST /api/agent/dispatch (channel='web') with the operator
 * persona's tenant + user id. Returns text + tool trail; we synthesize
 * a `tool_invocation` + `tool_result` pair per trail entry plus the
 * agent's text reply.
 *
 * Streaming endpoint comes later. Today this renders the full reply
 * in one shot once the dispatch resolves — same UX shape the existing
 * /dashboard/console operator surface has today.
 */

import { useCallback, useState, type JSX } from 'react';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';

import { renderForOperator, type ChannelMessage } from '@/lib/channel-render';

interface DispatchTrailItem {
  toolName: string;
  ok: boolean;
  latencyMs: number;
  priceMicroUsdc: string;
}

interface DispatchResponse {
  text?: string;
  trail?: DispatchTrailItem[];
  latencyMs?: number;
  billed?: boolean;
  error?: string;
  message?: string;
}

interface Props {
  tenantId: string;
}

export function AgentChatClient({ tenantId }: Props) {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setBusy(true);

      const operatorMsg: ChannelMessage = {
        kind: 'text',
        id: `op-${Date.now()}`,
        author: { role: 'operator', name: 'You' },
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, operatorMsg]);
      setInput('');

      try {
        const r = await fetch('/api/agent/dispatch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            channel: 'web',
            text: trimmed,
          }),
        });
        const json = (await r.json()) as DispatchResponse;
        if (!r.ok) {
          const errMsg: ChannelMessage = {
            kind: 'text',
            id: `err-${Date.now()}`,
            author: { role: 'system', name: 'Sendero AI' },
            content: `Error: ${json.error ?? r.status} - ${json.message ?? 'unknown'}`,
            createdAt: new Date().toISOString(),
          };
          setMessages(prev => [...prev, errMsg]);
          return;
        }

        const synthesized = synthesizeFromDispatch(json);
        setMessages(prev => [...prev, ...synthesized]);
      } catch (err) {
        const errMsg: ChannelMessage = {
          kind: 'text',
          id: `err-${Date.now()}`,
          author: { role: 'system', name: 'Sendero AI' },
          content: `Network error: ${err instanceof Error ? err.message : String(err)}`,
          createdAt: new Date().toISOString(),
        };
        setMessages(prev => [...prev, errMsg]);
      } finally {
        setBusy(false);
      }
    },
    [busy, tenantId]
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map(msg => (
              <Message
                key={msg.id}
                from={
                  msg.author.role === 'operator'
                    ? 'user'
                    : msg.author.role === 'agent'
                      ? 'assistant'
                      : msg.author.role === 'traveler'
                        ? 'user'
                        : 'system'
                }
              >
                {renderForOperator(msg)}
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput
        onSubmit={(message, evt) => {
          evt.preventDefault();
          void submit(message.text || input);
        }}
        className="border-t border-border"
      >
        <PromptInputBody>
          <PromptInputTextarea
            value={input}
            onChange={evt => setInput(evt.target.value)}
            placeholder="Ask Sendero anything · /scope @trp- · /policy · /spend"
            disabled={busy}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit
            disabled={busy || input.trim().length === 0}
            status={busy ? 'submitted' : undefined}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        Sendero AI · ready
      </div>
      <div className="max-w-md text-sm text-muted-foreground">
        Ask the agent to search flights, run policy checks, propose order changes, or recommend
        restaurants. Tool calls render inline — the same canonical messages that flow to WhatsApp /
        Slack / web travelers.
      </div>
    </div>
  );
}

/**
 * Convert a single dispatch response into a sequence of canonical
 * channel messages: one tool_invocation + one tool_result per trail
 * entry, then the final text reply.
 *
 * Today the dispatch route doesn't return per-tool inputs/outputs in
 * the trail (privacy + payload size). When streaming dispatch lands,
 * those bodies populate the synthesized tool_result entries.
 */
function synthesizeFromDispatch(resp: DispatchResponse): ChannelMessage[] {
  const out: ChannelMessage[] = [];
  const now = Date.now();
  const trail = resp.trail ?? [];

  for (let i = 0; i < trail.length; i++) {
    const t = trail[i];
    if (!t) continue;
    out.push({
      kind: 'tool_invocation',
      id: `inv-${now}-${i}`,
      author: { role: 'agent', name: 'Sendero AI' },
      toolName: t.toolName,
      input: {},
      status: t.ok ? 'done' : 'error',
      errorMessage: t.ok ? undefined : 'tool returned not-ok',
      latencyMs: t.latencyMs,
      createdAt: new Date(now + i).toISOString(),
    });
    if (t.ok) {
      out.push({
        kind: 'tool_result',
        id: `res-${now}-${i}`,
        author: { role: 'agent', name: 'Sendero AI' },
        toolName: t.toolName,
        result: { ok: true, latencyMs: t.latencyMs },
        createdAt: new Date(now + i).toISOString(),
      });
    }
  }

  if (resp.text) {
    out.push({
      kind: 'text',
      id: `agent-${now}`,
      author: { role: 'agent', name: 'Sendero AI' },
      content: resp.text,
      createdAt: new Date(now + trail.length).toISOString(),
    });
  }

  return out;
}
