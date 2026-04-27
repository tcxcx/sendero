'use client';

/**
 * Compact model-selector trigger used at the top of `/dashboard/console`
 * and `/dashboard/agent-chat`. Same widget, same persisted state via
 * `useChatModel`. Visual style follows DESIGN.md — parchment surface,
 * dim hairline border, ink text, no shadow.
 *
 * Only chat models live here. OCR / embedding / vision / agent-tier
 * models stay pinned server-side.
 */

import { useCallback, useState } from 'react';
import { CheckIcon } from 'lucide-react';

import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from '@/components/ai-elements/model-selector';
import { useChatModel } from '@/hooks/use-chat-model';

export interface ChatModelOption {
  id: string;
  name: string;
  chef: string;
  chefSlug: string;
}

// Curated list. Gateway slug format: `provider/model`.
export const CHAT_MODEL_OPTIONS: ChatModelOption[] = [
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    chef: 'Google',
    chefSlug: 'google',
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    chef: 'Google',
    chefSlug: 'google',
  },
  {
    id: 'anthropic/claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
  },
  {
    id: 'anthropic/claude-opus-4-1',
    name: 'Claude Opus 4.1',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
  },
  {
    id: 'openai/gpt-5',
    name: 'GPT-5',
    chef: 'OpenAI',
    chefSlug: 'openai',
  },
  {
    id: 'openai/gpt-5-mini',
    name: 'GPT-5 Mini',
    chef: 'OpenAI',
    chefSlug: 'openai',
  },
];

const CHEF_ORDER = ['Google', 'Anthropic', 'OpenAI'] as const;

export function ChatModelTrigger() {
  const [model, setModel] = useChatModel();
  const [open, setOpen] = useState(false);
  const selected = CHAT_MODEL_OPTIONS.find(m => m.id === model) ?? CHAT_MODEL_OPTIONS[0];

  const onSelect = useCallback(
    (id: string) => {
      setModel(id);
      setOpen(false);
    },
    [setModel]
  );

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild>
        <button
          type="button"
          aria-label={`Chat model: ${selected.name}`}
          className="inline-flex items-center gap-2 rounded-md border border-[color:var(--hairline-color-soft)] bg-[color:var(--surface-raised)] px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[color:var(--ink)] shadow-none transition-colors hover:border-[color:var(--hairline-color-strong)] focus:border-[color:var(--hairline-color-strong)] focus:outline-none"
        >
          <ModelSelectorLogo provider={selected.chefSlug} />
          <ModelSelectorName>{selected.name}</ModelSelectorName>
        </button>
      </ModelSelectorTrigger>
      <ModelSelectorContent className="border border-[color:var(--hairline-color-soft)] bg-[color:var(--surface-raised)] shadow-none">
        <ModelSelectorInput placeholder="Search chat models…" />
        <ModelSelectorList>
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
          {CHEF_ORDER.map(chef => (
            <ModelSelectorGroup key={chef} heading={chef}>
              {CHAT_MODEL_OPTIONS.filter(m => m.chef === chef).map(m => (
                <ModelSelectorItem key={m.id} value={m.id} onSelect={() => onSelect(m.id)}>
                  <ModelSelectorLogo provider={m.chefSlug} />
                  <ModelSelectorName>{m.name}</ModelSelectorName>
                  {model === m.id ? (
                    <CheckIcon className="ml-auto size-4 text-[color:var(--ink)]" />
                  ) : (
                    <div className="ml-auto size-4" />
                  )}
                </ModelSelectorItem>
              ))}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}
