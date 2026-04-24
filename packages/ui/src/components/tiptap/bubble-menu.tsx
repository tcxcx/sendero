'use client';

import { useState } from 'react';

import { type Editor, BubbleMenu as TiptapBubbleMenu } from '@tiptap/react';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Sparkles,
  Underline as UnderlineIcon,
} from 'lucide-react';

import { AIMenu } from './ai-menu';
import { BubbleButton } from './bubble-button';
import { LinkPopover } from './link-popover';
import type { RewriteContext, RewriteFn } from './types';

interface SupportBubbleMenuProps {
  editor: Editor;
  context: RewriteContext;
  rewrite: RewriteFn;
}

export function SupportBubbleMenu({ editor, context, rewrite }: SupportBubbleMenuProps) {
  const [showAI, setShowAI] = useState(false);

  return (
    <TiptapBubbleMenu
      editor={editor}
      tippyOptions={{
        duration: 120,
        placement: 'top',
        maxWidth: 'none',
      }}
    >
      <div className="flex w-fit max-w-[90vw] overflow-hidden border border-[color:var(--border)] bg-[color:var(--bg-elev)] font-mono shadow-sm">
        {showAI ? (
          <AIMenu
            editor={editor}
            context={context}
            rewrite={rewrite}
            onClose={() => setShowAI(false)}
          />
        ) : (
          <>
            <BubbleButton action={() => setShowAI(true)} tooltip="Rewrite with AI">
              <span className="flex items-center gap-1.5 text-[color:var(--ink)]">
                <Sparkles className="size-3.5" />
                <span>Ask AI</span>
              </span>
            </BubbleButton>

            <span className="my-1 w-px bg-[color:var(--border)]" aria-hidden="true" />

            <BubbleButton
              action={() => editor.chain().focus().toggleBold().run()}
              isActive={editor.isActive('bold')}
              tooltip="Bold (⌘B)"
            >
              <Bold className="size-3.5" />
            </BubbleButton>
            <BubbleButton
              action={() => editor.chain().focus().toggleItalic().run()}
              isActive={editor.isActive('italic')}
              tooltip="Italic (⌘I)"
            >
              <Italic className="size-3.5" />
            </BubbleButton>
            <BubbleButton
              action={() => editor.chain().focus().toggleUnderline().run()}
              isActive={editor.isActive('underline')}
              tooltip="Underline (⌘U)"
            >
              <UnderlineIcon className="size-3.5" />
            </BubbleButton>
            <BubbleButton
              action={() => editor.chain().focus().toggleBulletList().run()}
              isActive={editor.isActive('bulletList')}
              tooltip="Bullet list"
            >
              <List className="size-3.5" />
            </BubbleButton>
            <BubbleButton
              action={() => editor.chain().focus().toggleOrderedList().run()}
              isActive={editor.isActive('orderedList')}
              tooltip="Numbered list"
            >
              <ListOrdered className="size-3.5" />
            </BubbleButton>
            <LinkPopover editor={editor} />
          </>
        )}
      </div>
    </TiptapBubbleMenu>
  );
}
