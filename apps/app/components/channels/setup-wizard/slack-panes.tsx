'use client';

/**
 * Per-step pane renderers for the Slack setup wizard.
 *
 * Mirrors whatsapp-panes.tsx but with Slack's flow: install → pick
 * workspace → route channels → invite bot → send test.
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Loader2 } from 'lucide-react';

import type { WizardPaneProps, WizardPaneRenderer } from './types';

const PILL_FONT =
  'font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-faint)]';
const FIELD_LABEL =
  'font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-dim)]';

interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

interface SlackInstallSummary {
  installId: string;
  teamId: string;
  teamName: string;
  enterpriseId: string | null;
  enterpriseName: string | null;
  isEnterpriseInstall: boolean;
  scopeCount: number;
}

const EVENT_CLASSES = [
  { id: 'trip_events', label: 'All trip events', defaultMode: 'route' as const },
  { id: 'settlements', label: 'Settlements + invoices', defaultMode: 'route' as const },
  { id: 'cap_warnings', label: 'Spend-cap warnings', defaultMode: 'filter' as const },
  { id: 'escalations', label: 'Cap breaches + over-policy', defaultMode: 'route' as const },
  { id: 'silent', label: 'Health pings (suppressed)', defaultMode: 'silent' as const },
];

export const slackPanes: Record<string, WizardPaneRenderer> = {
  'slack.install': InstallPane,
  'slack.pick_workspace': PickWorkspacePane,
  'slack.route_channels': RouteChannelsPane,
  'slack.invite_bot': InviteBotPane,
  'slack.send_test': SendTestPane,
};

// ─── 1. install ──────────────────────────────────────────────────────

function InstallPane({ scratchpad, setResolution, pending }: WizardPaneProps) {
  const install = scratchpad.install as
    | { installUrl?: string; configured?: boolean; expiresAt?: string }
    | undefined;
  const [installs, setInstalls] = useState<SlackInstallSummary[]>([]);
  const [polling, setPolling] = useState(true);

  // Poll the OAuth callback every 4s while we're on this step.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/channels/slack/installs');
        if (cancelled) return;
        const data = (await res.json()) as { installs: SlackInstallSummary[] };
        setInstalls(data.installs ?? []);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      setPolling(false);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (installs.length > 0) {
      setResolution({ installCount: installs.length });
    } else {
      setResolution(null);
    }
  }, [installs, setResolution]);

  if (!install?.configured) {
    return (
      <div className="rounded-md border border-[color:var(--accent-amber,#d97706)] bg-[color:color-mix(in_oklab,var(--accent-amber,#d97706)_8%,transparent)] p-4 text-sm text-[color:var(--text)]">
        Slack OAuth is not configured. Set <code className="font-mono">SLACK_CLIENT_ID</code> +{' '}
        <code className="font-mono">SLACK_CLIENT_SECRET</code> in env, then reload the wizard.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_280px]">
      <div className="flex flex-col gap-4">
        <a
          href={install.installUrl ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-2 rounded-md bg-[color:#4A154B] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <ExternalLink className="h-4 w-4" />
          Open Slack install
        </a>
        <p className="max-w-[60ch] text-sm leading-relaxed text-[color:var(--text-dim)]">
          Click the button to install Sendero into your workspace. Approve the bot scopes; the OAuth
          callback writes the install row and this wizard advances automatically.
        </p>
        <div className="flex items-center gap-2 text-[12px] text-[color:var(--text-dim)]">
          {installs.length === 0 && polling ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Watching for the OAuth callback…
            </>
          ) : installs.length > 0 ? (
            <span className="text-[color:var(--accent-green,#16a34a)]">
              ✓ Install detected on {installs.length} workspace
              {installs.length === 1 ? '' : 's'}.
            </span>
          ) : null}
        </div>
      </div>
      <aside className="flex flex-col gap-2 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[color:var(--surface-raised)] p-4">
        <span className={PILL_FONT}>What we ask for</span>
        <ul className="flex flex-col gap-1 text-[12px] text-[color:var(--text-dim)]">
          <li>chat:write — post in channels</li>
          <li>commands — register /sendero</li>
          <li>im:history — read DMs to the bot</li>
          <li>users:read.email — match users to org seats</li>
        </ul>
      </aside>
    </div>
  );
}

// ─── 2. pick workspace ───────────────────────────────────────────────

function PickWorkspacePane({ setResolution }: WizardPaneProps) {
  const [installs, setInstalls] = useState<SlackInstallSummary[]>([]);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/channels/slack/installs')
      .then(r => r.json())
      .then((data: { installs: SlackInstallSummary[] }) => {
        setInstalls(data.installs ?? []);
        setPicked(data.installs?.[0]?.installId ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (picked) {
      setResolution({ installId: picked });
    } else {
      setResolution(null);
    }
  }, [picked, setResolution]);

  if (installs.length === 0) {
    return (
      <p className="text-sm text-[color:var(--text-dim)]">
        No installs found. Go back and complete the OAuth step.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-[color:color-mix(in_oklab,var(--ink)_8%,transparent)] overflow-hidden rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)]">
      {installs.map(i => {
        const on = i.installId === picked;
        const id =
          i.isEnterpriseInstall && i.enterpriseName
            ? `${i.enterpriseName} (Grid) · ${i.teamName}`
            : i.teamName;
        return (
          <li key={i.installId}>
            <button
              type="button"
              onClick={() => setPicked(i.installId)}
              className={
                'flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors ' +
                (on
                  ? 'bg-[color:color-mix(in_oklab,var(--accent-rose)_8%,transparent)]'
                  : 'hover:bg-[color:color-mix(in_oklab,var(--ink)_4%,transparent)]')
              }
            >
              <div className="flex flex-col">
                <span className="text-[14px] font-medium text-[color:var(--ink)]">{id}</span>
                <span className="text-[11px] text-[color:var(--text-dim)]">
                  {i.scopeCount} scopes · team_id {i.teamId}
                </span>
              </div>
              {on ? (
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[color:var(--accent-rose)] text-white">
                  <Check className="h-3 w-3" />
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ─── 3. route channels ───────────────────────────────────────────────

function RouteChannelsPane({ scratchpad, setResolution }: WizardPaneProps) {
  const installId = (scratchpad.pick_workspace as { installId?: string } | undefined)?.installId;
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [defaultChannelId, setDefaultChannelId] = useState<string | null>(null);
  const [routes, setRoutes] = useState<
    Record<string, { channelId: string; mode: 'route' | 'filter' | 'silent' }>
  >({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!installId) return;
    setLoading(true);
    fetch(`/api/channels/slack/channels?installId=${installId}`)
      .then(r => r.json())
      .then((data: { channels: SlackChannel[] }) => {
        const list = data.channels ?? [];
        setChannels(list);
        const def = list[0]?.id ?? null;
        setDefaultChannelId(def);
        const initial: typeof routes = {};
        for (const cls of EVENT_CLASSES) {
          initial[cls.id] = { channelId: def ?? '', mode: cls.defaultMode };
        }
        setRoutes(initial);
      })
      .finally(() => setLoading(false));
  }, [installId]);

  useEffect(() => {
    if (!defaultChannelId) {
      setResolution(null);
      return;
    }
    const arr = Object.entries(routes).map(([eventClass, r]) => ({
      eventClass,
      channelId: r.channelId || defaultChannelId,
      mode: r.mode,
    }));
    setResolution({ defaultChannelId, routes: arr });
  }, [routes, defaultChannelId, setResolution]);

  if (loading) {
    return <p className="text-sm text-[color:var(--text-dim)]">Loading channels…</p>;
  }
  if (channels.length === 0) {
    return (
      <p className="text-sm text-[color:var(--text-dim)]">
        Sendero couldn&rsquo;t list channels (missing scope?). Reinstall with the right scopes.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label className={FIELD_LABEL}>Default channel</label>
        <select
          value={defaultChannelId ?? ''}
          onChange={e => setDefaultChannelId(e.target.value)}
          className="w-full max-w-md rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 text-sm text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
        >
          {channels.map(c => (
            <option key={c.id} value={c.id}>
              #{c.name}
              {c.isPrivate ? ' (private)' : ''}
            </option>
          ))}
        </select>
      </div>

      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="text-left">
            <th className={`${FIELD_LABEL} pb-2`}>Event class</th>
            <th className={`${FIELD_LABEL} pb-2`}>Channel</th>
            <th className={`${FIELD_LABEL} w-32 pb-2`}>Mode</th>
          </tr>
        </thead>
        <tbody>
          {EVENT_CLASSES.map(cls => {
            const route = routes[cls.id];
            return (
              <tr
                key={cls.id}
                className="border-t border-[color:color-mix(in_oklab,var(--ink)_8%,transparent)]"
              >
                <td className="py-2 pr-3 text-[13px] text-[color:var(--ink)]">{cls.label}</td>
                <td className="py-2 pr-3">
                  <select
                    value={route?.channelId ?? defaultChannelId ?? ''}
                    onChange={e =>
                      setRoutes(prev => ({
                        ...prev,
                        [cls.id]: {
                          ...(prev[cls.id] ?? { mode: cls.defaultMode }),
                          channelId: e.target.value,
                        },
                      }))
                    }
                    className="w-full rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-2 py-1 text-[12px] text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
                  >
                    {channels.map(c => (
                      <option key={c.id} value={c.id}>
                        #{c.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2">
                  <select
                    value={route?.mode ?? cls.defaultMode}
                    onChange={e =>
                      setRoutes(prev => ({
                        ...prev,
                        [cls.id]: {
                          ...(prev[cls.id] ?? { channelId: defaultChannelId ?? '' }),
                          mode: e.target.value as 'route' | 'filter' | 'silent',
                        },
                      }))
                    }
                    className="w-full rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-2 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
                  >
                    <option value="route">ROUTE</option>
                    <option value="filter">FILTER</option>
                    <option value="silent">SILENT</option>
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── 4. invite bot ───────────────────────────────────────────────────

function InviteBotPane({ scratchpad, setResolution }: WizardPaneProps) {
  const routes = scratchpad.route_channels as
    | { routes?: Array<{ channelId: string; mode: string }>; defaultChannelId?: string }
    | undefined;
  const channelIds = useMemo(() => {
    const ids = new Set<string>();
    if (routes?.defaultChannelId) ids.add(routes.defaultChannelId);
    for (const r of routes?.routes ?? []) {
      if (r.mode !== 'silent' && r.channelId) ids.add(r.channelId);
    }
    return Array.from(ids);
  }, [routes]);

  useEffect(() => {
    if (channelIds.length > 0) {
      setResolution({ channelIds });
    } else {
      setResolution(null);
    }
  }, [channelIds, setResolution]);

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[60ch] text-sm leading-relaxed text-[color:var(--text-dim)]">
        Sendero will join these channels so it can post without hitting{' '}
        <code className="font-mono">not_in_channel</code>. We invite ourselves; you don&rsquo;t have
        to do it manually.
      </p>
      <ul className="flex flex-col gap-1 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[color:var(--surface-raised)] p-3">
        {channelIds.map(id => (
          <li key={id} className="font-mono text-[12px] text-[color:var(--ink)]">
            ↪ {id}
          </li>
        ))}
        {channelIds.length === 0 ? (
          <li className="text-[12px] text-[color:var(--text-dim)]">
            No channels referenced. Go back and pick at least one.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

// ─── 5. send test ────────────────────────────────────────────────────

function SendTestPane({ scratchpad, setResolution }: WizardPaneProps) {
  const routes = scratchpad.route_channels as { defaultChannelId?: string } | undefined;
  const [channelId, setChannelId] = useState<string>(routes?.defaultChannelId ?? '');
  const [text, setText] = useState(
    "🌅 Sendero is connected. I'll post trip events, settlements, and cap warnings here per your routing rules."
  );

  useEffect(() => {
    if (!channelId) {
      setResolution(null);
      return;
    }
    setResolution({ channelId, text });
  }, [channelId, text, setResolution]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className={FIELD_LABEL}>Send test to</label>
        <input
          type="text"
          value={channelId}
          onChange={e => setChannelId(e.target.value)}
          placeholder="C0123456789"
          className="w-full max-w-md rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 font-mono text-sm text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={FIELD_LABEL}>Message body</label>
        <textarea
          rows={3}
          value={text}
          maxLength={2000}
          onChange={e => setText(e.target.value)}
          className="w-full max-w-2xl rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 text-sm leading-relaxed text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
        />
      </div>
    </div>
  );
}
