'use client';

import { Composer, Thread } from '@liveblocks/react-ui';
import { useThreads } from '@sendero/collaboration/client';
import { MessageSquare } from 'lucide-react';

type TripCommentsProps = {
  tripId: string;
};

export function TripComments({ tripId }: TripCommentsProps) {
  const { threads, error, isLoading } = useThreads({
    query: {
      metadata: {
        tripId,
      },
    },
  });

  return (
    <section
      className="rounded-lg border bg-background/95 p-3 shadow-sm"
      style={{ borderColor: 'var(--hairline-color)' }}
      aria-label="Trip collaboration comments"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="t-meta" style={{ fontSize: 10 }}>
            Collaboration
          </div>
          <div className="text-sm font-medium">Trip comments</div>
        </div>
        <MessageSquare className="size-4 text-[color:var(--ink)]" aria-hidden="true" />
      </div>

      <div className="flex flex-col gap-3">
        {isLoading ? (
          <CommentState label="Loading comments" />
        ) : error ? (
          <CommentState label="Comments unavailable" detail={error.message} />
        ) : threads.length === 0 ? (
          <CommentState
            label="No open threads"
            detail="Mention teammates or agents from the composer."
          />
        ) : (
          threads.map(thread => (
            <Thread
              key={thread.id}
              thread={thread}
              showComposer="collapsed"
              showActions="hover"
              showResolveAction
              showReactions
            />
          ))
        )}

        <Composer
          metadata={{
            kind: 'trip_note',
            tripId,
            status: 'open',
            priority: 'normal',
          }}
          showAttachments
          showFormattingControls
          overrides={{
            COMPOSER_PLACEHOLDER: 'Comment, @mention, or invite an agent...',
            COMPOSER_SEND: 'Post',
          }}
        />
      </div>
    </section>
  );
}

function CommentState({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="rounded-md border border-dashed px-3 py-4 text-center">
      <div className="text-sm font-medium">{label}</div>
      {detail ? <div className="mt-1 text-xs text-[color:var(--text-dim)]">{detail}</div> : null}
    </div>
  );
}
