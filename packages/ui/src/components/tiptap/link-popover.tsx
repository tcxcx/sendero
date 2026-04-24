'use client';

import { useRef, useState } from 'react';

import type { Editor } from '@tiptap/react';
import { Check, Link2, Link2Off, Trash2 } from 'lucide-react';

import { BubbleButton } from './bubble-button';

function formatUrl(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(v)) return `https://${v}`;
  return null;
}

export function LinkPopover({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isActive = editor.isActive('link');
  const current = editor.getAttributes('link').href as string | undefined;

  const submit = () => {
    const url = formatUrl(value);
    if (!url) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    setOpen(false);
    setValue('');
  };

  return (
    <div className="relative">
      <BubbleButton
        action={() => setOpen(o => !o)}
        isActive={isActive}
        tooltip={current ? 'Edit link' : 'Add link (⌘K)'}
      >
        {current ? <Link2Off className="size-3.5" /> : <Link2 className="size-3.5" />}
      </BubbleButton>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1 flex w-60 border border-[color:var(--border)] bg-[color:var(--bg-elev)] p-1 shadow-sm">
          <input
            ref={inputRef}
            type="text"
            placeholder="Paste link"
            defaultValue={current ?? ''}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            className="h-7 flex-1 bg-transparent px-2 font-mono text-[11px] text-[color:var(--text)] outline-none placeholder:text-[color:var(--text-faint)]"
          />
          {current ? (
            <button
              type="button"
              onClick={() => {
                editor.chain().focus().unsetLink().run();
                setOpen(false);
              }}
              className="flex size-7 items-center justify-center text-[color:var(--accent-rose)] hover:bg-[color:var(--bg-sunk)]"
              aria-label="Remove link"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              className="flex size-7 items-center justify-center text-[color:var(--ink)] hover:bg-[color:var(--bg-sunk)]"
              aria-label="Apply link"
            >
              <Check className="size-3.5" />
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
