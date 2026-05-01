'use client';

import { useState } from 'react';

import {
  useDeleteAllInboxNotifications,
  useDeleteInboxNotification,
  useInboxNotifications,
  useMarkAllInboxNotificationsAsRead,
  useMarkInboxNotificationAsRead,
  useUnreadInboxNotificationsCount,
} from '@liveblocks/react';
import {
  InboxNotification,
  type InboxNotificationCustomKindProps,
  InboxNotificationList,
} from '@liveblocks/react-ui';
import { Bell, CheckCheck, Inbox, Trash2, X } from 'lucide-react';

export function LiveblocksInboxButton() {
  const [open, setOpen] = useState(false);
  const unread = useUnreadInboxNotificationsCount();
  const count = unread.count ?? 0;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="relative grid h-9 w-9 place-items-center rounded-md border bg-[color:var(--surface-floating)] text-[color:var(--text)] shadow-sm transition hover:bg-[color:var(--tint-vermillion-soft)]"
        style={{ borderColor: 'var(--hairline-color)' }}
        aria-label={count > 0 ? `${count} unread collaboration notifications` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell className="size-4" aria-hidden="true" />
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-[color:var(--ink)] px-1 text-center font-mono text-[10px] leading-4 text-white">
            {count > 9 ? '9+' : count}
          </span>
        ) : null}
      </button>

      {open ? <LiveblocksInboxPanel onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function LiveblocksInboxPanel({ onClose }: { onClose: () => void }) {
  const { inboxNotifications, error, isLoading } = useInboxNotifications();
  const markAllAsRead = useMarkAllInboxNotificationsAsRead();
  const markAsRead = useMarkInboxNotificationAsRead();
  const deleteNotification = useDeleteInboxNotification();
  const deleteAllNotifications = useDeleteAllInboxNotifications();

  return (
    <div
      className="absolute right-0 top-11 z-[90] w-[min(420px,calc(100vw-24px))] overflow-hidden rounded-lg border bg-[color:var(--surface-floating)] shadow-[var(--shadow-xl)]"
      style={{ borderColor: 'var(--hairline-color)' }}
    >
      <div
        className="flex items-center justify-between gap-3 border-b px-3 py-3"
        style={{ borderColor: 'var(--hairline-color)' }}
      >
        <div>
          <div className="t-meta" style={{ fontSize: 10 }}>
            Route inbox
          </div>
          <div className="text-sm font-medium">Liveblocks notifications</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => markAllAsRead()}
            className="grid size-8 place-items-center rounded-md text-[color:var(--text-dim)] transition hover:bg-[color:var(--tint-vermillion-soft)] hover:text-[color:var(--ink)]"
            title="Mark all read"
            aria-label="Mark all notifications as read"
          >
            <CheckCheck className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => deleteAllNotifications()}
            className="grid size-8 place-items-center rounded-md text-[color:var(--text-dim)] transition hover:bg-[color:var(--tint-vermillion-soft)] hover:text-[color:var(--ink)]"
            title="Delete all"
            aria-label="Delete all notifications"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-md text-[color:var(--text-dim)] transition hover:bg-[color:var(--tint-vermillion-soft)] hover:text-[color:var(--ink)]"
            aria-label="Close notifications"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="max-h-[min(560px,70vh)] overflow-auto p-2">
        {isLoading ? (
          <InboxState label="Syncing route inbox" />
        ) : error ? (
          <InboxState label="Notifications unavailable" detail={error.message} />
        ) : inboxNotifications.length === 0 ? (
          <InboxState
            label="No unread route activity"
            detail="Mentions, support handoffs, Slack, WhatsApp, and agent escalations will appear here."
          />
        ) : (
          <InboxNotificationList className="lb-sendero-inbox-list">
            {inboxNotifications.map(notification => (
              <InboxNotification
                key={notification.id}
                inboxNotification={notification}
                showActions="hover"
                onClick={event => {
                  markAsRead(notification.id);
                  const href = event.currentTarget.getAttribute('href');
                  if (href) onClose();
                }}
                kinds={{
                  $runUpdate: CustomNotification,
                  $handoffRequired: CustomNotification,
                  $digestReady: CustomNotification,
                }}
                onKeyDown={event => {
                  if (event.key === 'Backspace' || event.key === 'Delete') {
                    event.preventDefault();
                    deleteNotification(notification.id);
                  }
                }}
              />
            ))}
          </InboxNotificationList>
        )}
      </div>
    </div>
  );
}

function InboxState({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      <Inbox className="size-5 text-[color:var(--ink)]" aria-hidden="true" />
      <div className="text-sm font-medium">{label}</div>
      {detail ? <p className="max-w-72 text-xs text-[color:var(--text-dim)]">{detail}</p> : null}
    </div>
  );
}

function CustomNotification(props: InboxNotificationCustomKindProps) {
  const activity = props.inboxNotification.activities[0];
  const data = activity?.data as { title?: string; message?: string; url?: string } | undefined;

  return (
    <InboxNotification.Custom
      {...props}
      href={data?.url ?? props.href}
      title={data?.title ?? 'Sendero update'}
      aside={
        <InboxNotification.Icon>
          <Bell className="size-4" aria-hidden="true" />
        </InboxNotification.Icon>
      }
    >
      {data?.message ?? props.children}
    </InboxNotification.Custom>
  );
}
