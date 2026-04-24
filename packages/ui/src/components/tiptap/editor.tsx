'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';

import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import { type Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

import { cn } from '../../utils/cn';

import { SupportBubbleMenu } from './bubble-menu';
import type { RewriteContext, RewriteFn } from './types';

interface SupportEditorProps {
  /** Plain-text controlled value. Tiptap edits in rich mode; we flatten on change. */
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Called on Enter (without shift). Omit to allow newlines only. */
  onEnter?: () => void;
  rewrite: RewriteFn;
  context: RewriteContext;
  className?: string;
  /** Slot rendered below the editor (used for the polish-suggestion chip). */
  footerSlot?: ReactNode;
  /** Exposes the underlying editor so the parent can imperatively clear it, etc. */
  onReady?: (editor: Editor) => void;
  /**
   * Accessible label for the editor's contenteditable root. Tiptap renders a
   * raw `<div contenteditable>` which is otherwise opaque to screen readers
   * and Playwright's `getByRole('textbox', …)` lookups. Required so the
   * composer is discoverable through standard accessibility tooling.
   */
  ariaLabel: string;
  /** Stable selector for tests / automation. */
  testId?: string;
}

export function SupportEditor({
  value,
  onChange,
  placeholder,
  disabled,
  onEnter,
  rewrite,
  context,
  className,
  footerSlot,
  onReady,
  ariaLabel,
  testId,
}: SupportEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': ariaLabel,
        'aria-multiline': 'true',
        'aria-disabled': disabled ? 'true' : 'false',
        ...(testId ? { 'data-testid': testId } : {}),
        class: cn(
          'prose-none min-h-[72px] w-full resize-none bg-transparent px-4 py-3 text-[13px] leading-[1.5] text-[color:var(--text)] outline-none',
          '[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-[color:var(--text-faint)] [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
          '[&_a]:text-[color:var(--ink)] [&_a]:underline'
        ),
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && !event.shiftKey && onEnter) {
          event.preventDefault();
          onEnter();
          return true;
        }
        return false;
      },
    },
    content: value,
    editable: !disabled,
    onUpdate: ({ editor: ed }) => onChange(ed.getText()),
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) return;
    onReady?.(editor);
  }, [editor, onReady]);

  // Sync external value → editor when it diverges (parent clears, etc.).
  useEffect(() => {
    if (!editor) return;
    if (editor.getText() === value) return;
    editor.commands.setContent(value, false);
  }, [editor, value]);

  if (!editor) return null;

  return (
    <div className={cn('flex w-full flex-col', className)}>
      <div className="relative flex-1">
        <EditorContent editor={editor} />
        <SupportBubbleMenu editor={editor} context={context} rewrite={rewrite} />
      </div>
      {footerSlot}
    </div>
  );
}
