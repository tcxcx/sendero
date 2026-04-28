'use client';

/**
 * SlackInstall lifecycle controls — split into two tightly-scoped
 * components so each can be placed where it belongs visually:
 *
 *   - `SlackInstallDisconnectButton` lives in the panel header next
 *     to "Add channel". Same horizontal line; one is destructive (red
 *     outline), the other is the primary CTA.
 *   - `SlackInstallChannelManager` lives below the routing table — a
 *     collapsed expander listing each routed channel with a "Leave"
 *     button. Out of the way until you need it.
 *
 * Both call the same /api/channels/slack/installs endpoints. Server
 * actions weren't worth the React-server-action boundary friction
 * here — plain `fetch` + `router.refresh()` keeps things simple.
 */

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

interface DisconnectButtonProps {
  installId: string;
  teamName: string;
}

export function SlackInstallDisconnectButton({ installId, teamName }: DisconnectButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const disconnect = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/channels/slack/installs/${encodeURIComponent(installId)}/disconnect`,
          { method: 'POST' }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? `disconnect failed (HTTP ${res.status})`);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'network error');
      }
    });
  };

  if (confirming) {
    return (
      <div
        role="alertdialog"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          background: 'color-mix(in oklab, var(--vermillion, #fb542b) 14%, transparent)',
          borderRadius: 6,
          fontSize: 12,
          color: 'var(--ink, #1f2a44)',
        }}
      >
        <span>Uninstall from {teamName}?</span>
        <button type="button" onClick={disconnect} disabled={pending} style={dangerBtn}>
          {pending ? 'Disconnecting…' : 'Confirm'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          style={ghostBtn}
        >
          Cancel
        </button>
        {error ? (
          <span role="alert" style={{ color: 'var(--vermillion, #fb542b)', fontSize: 11 }}>
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      disabled={pending}
      style={dangerOutlineBtn}
    >
      Disconnect workspace
    </button>
  );
}

interface ChannelManagerProps {
  installId: string;
  channels: Array<{
    channelId: string;
    channelLabel: string;
  }>;
}

export function SlackInstallChannelManager({ installId, channels }: ChannelManagerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyChannel, setBusyChannel] = useState<string | null>(null);

  if (channels.length === 0) return null;

  const leaveChannel = (channelId: string) => {
    setError(null);
    setBusyChannel(channelId);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/channels/slack/installs/${encodeURIComponent(installId)}/channels/${encodeURIComponent(channelId)}`,
          { method: 'DELETE' }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.message ?? body.error ?? `leave failed (HTTP ${res.status})`);
        } else {
          router.refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'network error');
      } finally {
        setBusyChannel(null);
      }
    });
  };

  return (
    <details
      style={{
        margin: '0 24px 16px',
        padding: '8px 12px',
        borderRadius: 6,
        background: 'var(--surface-floating, #fdfbf7)',
        border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 10%, transparent)',
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          fontSize: 12,
          color: 'var(--ink, #1f2a44)',
          userSelect: 'none',
          listStyle: 'none',
          fontWeight: 500,
        }}
      >
        Manage individual channels ▾
      </summary>
      <ul
        style={{
          margin: '10px 0 0',
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {channels.map(c => (
          <li
            key={c.channelId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 8px',
              borderRadius: 4,
              background: 'color-mix(in oklab, var(--ink, #1f2a44) 3%, transparent)',
              fontSize: 12,
            }}
          >
            <span className="t-mono" style={{ flex: 1, color: 'var(--ink, #1f2a44)' }}>
              {c.channelLabel}
            </span>
            <button
              type="button"
              onClick={() => leaveChannel(c.channelId)}
              disabled={pending && busyChannel === c.channelId}
              style={ghostBtn}
            >
              {pending && busyChannel === c.channelId ? 'Leaving…' : 'Leave'}
            </button>
          </li>
        ))}
      </ul>
      <p
        style={{
          margin: '10px 0 0',
          fontSize: 11,
          color: 'var(--text-dim, #666)',
          lineHeight: 1.5,
        }}
      >
        Leaving a channel removes the bot from Slack-side AND clears the routing rule. To re-add:
        invite the bot from inside the channel with <code className="t-mono">/invite @Sendero</code>
        , then reconfigure routing via &ldquo;Edit routes&rdquo;.
      </p>
      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 8,
            padding: '6px 10px',
            borderRadius: 4,
            background: 'color-mix(in oklab, var(--vermillion, #fb542b) 14%, transparent)',
            color: 'var(--vermillion, #fb542b)',
            fontSize: 11,
          }}
        >
          {error}
        </div>
      ) : null}
    </details>
  );
}

const dangerOutlineBtn: React.CSSProperties = {
  padding: '8px 14px',
  background: 'transparent',
  color: 'var(--vermillion, #fb542b)',
  border: '1px solid color-mix(in oklab, var(--vermillion, #fb542b) 35%, transparent)',
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'var(--font-mono-x, ui-monospace, monospace)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const dangerBtn: React.CSSProperties = {
  padding: '6px 12px',
  background: 'var(--vermillion, #fb542b)',
  color: '#fdfbf7',
  border: 0,
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'var(--font-mono-x, ui-monospace, monospace)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const ghostBtn: React.CSSProperties = {
  padding: '6px 10px',
  background: 'transparent',
  color: 'var(--ink, #1f2a44)',
  border: '1px solid color-mix(in oklab, var(--ink, #1f2a44) 18%, transparent)',
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'var(--font-mono-x, ui-monospace, monospace)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
