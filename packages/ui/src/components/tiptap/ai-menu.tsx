'use client';

import { useState } from 'react';

import type { Editor } from '@tiptap/react';
import {
  ArrowUpRight,
  Globe,
  Loader2,
  Luggage,
  MessageCircle,
  Scissors,
  Sparkles,
  SpellCheck,
  Sun,
} from 'lucide-react';

import { cn } from '../../utils/cn';

import { BubbleButton } from './bubble-button';
import type { RewriteContext, RewriteFn, RewriteMode } from './types';
import { useClickAway } from './use-click-away';

interface Selector {
  mode: RewriteMode;
  label: string;
  icon: typeof Sparkles;
  /** For translate, we pass a locale target via `translateTo`. */
  translateTo?: string;
}

const BASE_SELECTORS: Selector[] = [
  { mode: 'grammar', label: 'Fix grammar', icon: SpellCheck },
  { mode: 'shorter', label: 'Shorter', icon: Scissors },
  { mode: 'warmer', label: 'Warmer', icon: Sun },
  { mode: 'more_professional', label: 'More professional', icon: Sparkles },
  { mode: 'whatsapp', label: 'WhatsApp-friendly', icon: MessageCircle },
  { mode: 'explain_delay', label: 'Explain delay', icon: Luggage },
  { mode: 'escalate', label: 'Human escalation tone', icon: ArrowUpRight },
];

const TRANSLATE_SELECTORS: Selector[] = [
  { mode: 'translate', label: 'ES', icon: Globe, translateTo: 'es-MX' },
  { mode: 'translate', label: 'PT', icon: Globe, translateTo: 'pt-BR' },
  { mode: 'translate', label: 'EN', icon: Globe, translateTo: 'en-US' },
];

interface AIMenuProps {
  editor: Editor;
  context: RewriteContext;
  rewrite: RewriteFn;
  onClose: () => void;
}

export function AIMenu({ editor, context, rewrite, onClose }: AIMenuProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useClickAway<HTMLDivElement>(() => onClose());

  const run = async (selector: Selector) => {
    const { from, to } = editor.state.selection;
    const selected = from !== to ? editor.state.doc.textBetween(from, to, '\n') : editor.getText();
    if (!selected.trim()) {
      onClose();
      return;
    }

    setBusy(selector.mode + (selector.translateTo ?? ''));
    try {
      const ctx: RewriteContext = selector.translateTo
        ? { ...context, targetLocale: selector.translateTo }
        : context;
      const { output } = await rewrite({
        message: selected,
        mode: selector.mode,
        context: ctx,
      });
      if (!output) return;
      if (from !== to) {
        editor.chain().focus().insertContentAt({ from, to }, output).run();
      } else {
        editor.chain().focus().clearContent().insertContent(output).run();
      }
    } finally {
      setBusy(null);
      onClose();
    }
  };

  if (busy) {
    return (
      <div
        ref={ref}
        className="flex min-w-[200px] items-center justify-center gap-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink)]"
      >
        <Loader2 className="size-3.5 animate-spin" />
        <span>Rewriting…</span>
      </div>
    );
  }

  return (
    <div ref={ref} className="flex max-w-[90vw] flex-wrap items-center gap-px whitespace-nowrap">
      {BASE_SELECTORS.map(sel => (
        <BubbleButton
          key={sel.mode}
          action={() => run(sel)}
          tooltip={sel.label}
          className={cn('border-r border-[color:var(--border)] last:border-r-0')}
        >
          <span className="flex items-center gap-1.5">
            <sel.icon className="size-3" />
            <span>{sel.label}</span>
          </span>
        </BubbleButton>
      ))}
      <span className="mx-1 h-4 w-px bg-[color:var(--border)]" aria-hidden="true" />
      {TRANSLATE_SELECTORS.map(sel => (
        <BubbleButton
          key={sel.translateTo}
          action={() => run(sel)}
          tooltip={`Translate → ${sel.translateTo}`}
        >
          <span className="flex items-center gap-1.5">
            <sel.icon className="size-3" />
            <span>{sel.label}</span>
          </span>
        </BubbleButton>
      ))}
    </div>
  );
}
