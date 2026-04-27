'use client';

/**
 * Compact model-selector trigger used at the top of `/dashboard/console`
 * and `/dashboard/agent-chat`. Same widget, same persisted state via
 * `useChatModel`.
 *
 * Dropdown with provider webp icons (google/anthropic/openai). Uses
 * shadcn's DropdownMenuRadioGroup so the selection is keyboard-driven
 * with a single radio source of truth.
 *
 * Only chat models live here. OCR / embedding / vision / agent-tier
 * models stay pinned server-side.
 */

import { useCallback } from 'react';

import { ProviderIcon, type ProviderSlug } from '@sendero/icons/providers';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChatModel } from '@/hooks/use-chat-model';

export interface ChatModelOption {
  id: string;
  name: string;
  chef: 'Google' | 'Anthropic' | 'OpenAI';
  chefSlug: ProviderSlug;
}

export const CHAT_MODEL_OPTIONS: ChatModelOption[] = [
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', chef: 'Google', chefSlug: 'google' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', chef: 'Google', chefSlug: 'google' },
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
  { id: 'openai/gpt-5', name: 'GPT-5', chef: 'OpenAI', chefSlug: 'openai' },
  { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini', chef: 'OpenAI', chefSlug: 'openai' },
];

const CHEF_ORDER: Array<ChatModelOption['chef']> = ['Google', 'Anthropic', 'OpenAI'];

export function ChatModelTrigger() {
  const [model, setModel] = useChatModel();
  const selected = CHAT_MODEL_OPTIONS.find(m => m.id === model) ?? CHAT_MODEL_OPTIONS[0];

  const onValueChange = useCallback(
    (id: string) => {
      setModel(id);
    },
    [setModel]
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Chat model: ${selected.name}`}
          className="inline-flex items-center gap-2 rounded-md border-[color:var(--hairline-color-soft)] bg-[color:var(--surface-raised)] px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[color:var(--ink)] shadow-none hover:border-[color:var(--hairline-color-strong)] hover:bg-[color:var(--surface-raised)]"
        >
          <ProviderIcon slug={selected.chefSlug} size={14} />
          <span>{selected.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-56 border border-[color:var(--hairline-color-soft)] bg-[color:var(--surface-raised)]"
      >
        <DropdownMenuRadioGroup value={model} onValueChange={onValueChange}>
          {CHEF_ORDER.map((chef, chefIdx) => {
            const items = CHAT_MODEL_OPTIONS.filter(m => m.chef === chef);
            return (
              <DropdownMenuGroup key={chef}>
                {chefIdx > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  {chef}
                </DropdownMenuLabel>
                {items.map(m => (
                  <DropdownMenuRadioItem
                    key={m.id}
                    value={m.id}
                    className="gap-2 pl-8 [&>span:first-child]:left-2"
                  >
                    <ProviderIcon slug={m.chefSlug} size={14} />
                    <span className="text-[12px]">{m.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
