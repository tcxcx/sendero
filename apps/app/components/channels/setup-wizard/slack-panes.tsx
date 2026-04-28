'use client';

/**
 * Per-step pane renderers for the Slack setup wizard.
 *
 * Mirrors whatsapp-panes.tsx but with Slack's flow: install → pick
 * workspace → route channels → invite bot → send test.
 */

import { useEffect, useMemo, useState } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@sendero/ui/tooltip';
import { Check, ExternalLink, Info, Loader2 } from 'lucide-react';

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
  {
    id: 'trip_events',
    label: 'All trip events',
    defaultMode: 'route' as const,
    description: 'Search results, holds, ticketing, cancels — every step of a trip lifecycle.',
  },
  {
    id: 'settlements',
    label: 'Settlements + invoices',
    defaultMode: 'route' as const,
    description: 'Posts when nanopayment batches settle on chain and when traveler invoices issue.',
  },
  {
    id: 'cap_warnings',
    label: 'Spend-cap warnings',
    defaultMode: 'filter' as const,
    description: 'Heads-up alerts when a trip or org approaches its spend ceiling (75%, 90%).',
  },
  {
    id: 'escalations',
    label: 'Cap breaches + over-policy',
    defaultMode: 'route' as const,
    description: 'Hard escalations: cap exceeded or a trip violates your org travel policy.',
  },
  {
    id: 'silent',
    label: 'Health pings (suppressed)',
    defaultMode: 'silent' as const,
    description: 'Internal heartbeats; suppressed by default to keep your channel clean.',
  },
];

const COLUMN_HELP = {
  eventClass: 'Activity category Sendero will route from your tenant into Slack.',
  channel: 'Which Slack channel receives this event class. Defaults to the channel above.',
  mode: 'ROUTE = always post · FILTER = post only when relevant · SILENT = never post.',
};

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
        Sendero couldn&rsquo;t list channels (missing scope?).{' '}
        <a
          href="https://api.slack.com/apps"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 text-[color:var(--ink)] hover:text-[color:var(--accent-rose)]"
        >
          Reinstall
        </a>{' '}
        with the right scopes.
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
            <th className={`${FIELD_LABEL} pb-2`}>
              <HeaderWithHint label="Event class" hint={COLUMN_HELP.eventClass} />
            </th>
            <th className={`${FIELD_LABEL} pb-2`}>
              <HeaderWithHint label="Channel" hint={COLUMN_HELP.channel} />
            </th>
            <th className={`${FIELD_LABEL} w-32 pb-2`}>
              <HeaderWithHint label="Mode" hint={COLUMN_HELP.mode} />
            </th>
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
                <td className="py-2 pr-3 text-[13px] text-[color:var(--ink)]">
                  <span className="flex items-center justify-between gap-2">
                    <span>{cls.label}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`What is "${cls.label}"?`}
                          className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[color:var(--text-faint)] transition-colors hover:text-[color:var(--ink)] focus:text-[color:var(--ink)] focus:outline-none"
                        >
                          <Info className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="right"
                        className="max-w-xs border border-[color:var(--hairline-color-soft)] bg-[color:var(--surface-raised)] text-xs text-[color:var(--ink)] shadow-none"
                      >
                        {cls.description}
                      </TooltipContent>
                    </Tooltip>
                  </span>
                </td>
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
  const installId = (scratchpad.pick_workspace as { installId?: string } | undefined)?.installId;
  const teamId = (scratchpad.pick_workspace as { teamId?: string } | undefined)?.teamId;
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

  // Resolve channel names + privacy off the same endpoint RouteChannelsPane
  // uses, so cards show `#marketing (private · already a member)` instead
  // of a raw `C080ZB9PREF`.
  const [meta, setMeta] = useState<Record<string, SlackChannel> | null>(null);
  useEffect(() => {
    if (!installId) return;
    let cancelled = false;
    fetch(`/api/channels/slack/channels?installId=${installId}`)
      .then(r => r.json())
      .then((data: { channels?: SlackChannel[] }) => {
        if (cancelled) return;
        const map: Record<string, SlackChannel> = {};
        for (const c of data.channels ?? []) map[c.id] = c;
        setMeta(map);
      })
      .catch(() => {
        if (!cancelled) setMeta({});
      });
    return () => {
      cancelled = true;
    };
  }, [installId]);

  useEffect(() => {
    if (channelIds.length > 0) {
      setResolution({ channelIds });
    } else {
      setResolution(null);
    }
  }, [channelIds, setResolution]);

  const [copied, setCopied] = useState<string | null>(null);
  const copyInvite = async (channelId: string) => {
    try {
      await navigator.clipboard.writeText('/invite @sendero');
      setCopied(channelId);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard blocked — the slash command is visible in the card */
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[64ch] text-sm leading-relaxed text-[color:var(--text-dim)]">
        Sendero adds itself to <strong>public</strong> channels using{' '}
        <code className="font-mono text-[12px]">conversations.join</code> — no manual step. For{' '}
        <strong>private</strong> channels Slack requires a member to run{' '}
        <code className="font-mono text-[12px]">/invite @sendero</code> inside the channel.
      </p>

      {channelIds.length === 0 ? (
        <p className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[color:var(--surface-raised)] p-3 text-[12px] text-[color:var(--text-dim)]">
          No channels referenced. Go back and pick at least one.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {channelIds.map(id => {
            const ch = meta?.[id];
            const name = ch?.name ?? null;
            const isPrivate = ch?.isPrivate ?? false;
            const isMember = ch?.isMember ?? false;
            const status: 'ready' | 'public-auto' | 'manual' | 'unknown' = ch
              ? isMember
                ? 'ready'
                : isPrivate
                  ? 'manual'
                  : 'public-auto'
              : 'unknown';
            const deepLink = teamId
              ? `slack://channel?team=${teamId}&id=${id}`
              : `slack://channel?id=${id}`;

            return (
              <li
                key={id}
                className="flex items-center gap-3 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[color:var(--surface-raised)] px-3 py-2.5"
              >
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] text-[14px] text-[color:var(--ink)]"
                >
                  {isPrivate ? '🔒' : '#'}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-[color:var(--ink)]">
                      {name ? `#${name}` : id}
                    </span>
                    {isPrivate ? (
                      <span className={PILL_FONT}>private</span>
                    ) : (
                      <span className={PILL_FONT}>public</span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-[color:var(--text-faint)]">{id}</div>
                </div>
                <StatusChip status={status} />
                {status === 'manual' ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <a
                      href={deepLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-2.5 py-1 text-[11px] font-medium text-[color:var(--ink)] transition-colors hover:border-[color:var(--ink)]"
                    >
                      Open <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                    <button
                      type="button"
                      onClick={() => copyInvite(id)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--ink)] transition-colors hover:border-[color:var(--ink)]"
                    >
                      {copied === id ? 'Copied' : 'Copy /invite'}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: 'ready' | 'public-auto' | 'manual' | 'unknown' }) {
  if (status === 'unknown') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[color:color-mix(in_oklab,var(--ink)_14%,transparent)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[color:var(--text-faint)]">
        <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />
        checking
      </span>
    );
  }
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[color:color-mix(in_oklab,var(--accent-green,#6A8570)_18%,transparent)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[color:var(--accent-green,#6A8570)]">
        <Check className="h-2.5 w-2.5" aria-hidden />
        member
      </span>
    );
  }
  if (status === 'public-auto') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[color:color-mix(in_oklab,var(--ink)_10%,transparent)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[color:var(--ink)]">
        auto-join
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[color:color-mix(in_oklab,var(--accent-rose,#fb542b)_14%,transparent)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[color:var(--accent-rose,#fb542b)]">
      manual /invite
    </span>
  );
}

// ─── 5. send test ────────────────────────────────────────────────────

function SendTestPane({ scratchpad, setResolution }: WizardPaneProps) {
  const installId = (scratchpad.pick_workspace as { installId?: string } | undefined)?.installId;
  const teamName = (scratchpad.pick_workspace as { teamName?: string } | undefined)?.teamName;
  const routes = scratchpad.route_channels as { defaultChannelId?: string } | undefined;
  const [channelId, setChannelId] = useState<string>(routes?.defaultChannelId ?? '');
  const [text, setText] = useState(
    "🌅 Sendero is connected. I'll post trip events, settlements, and cap warnings here per your routing rules."
  );

  // Pull channel list so the select shows #names instead of raw IDs.
  // Same endpoint RouteChannelsPane / InviteBotPane use; cached at the
  // browser layer.
  const [channels, setChannels] = useState<SlackChannel[] | null>(null);
  useEffect(() => {
    if (!installId) return;
    let cancelled = false;
    fetch(`/api/channels/slack/channels?installId=${installId}`)
      .then(r => r.json())
      .then((data: { channels?: SlackChannel[] }) => {
        if (!cancelled) setChannels(data.channels ?? []);
      })
      .catch(() => {
        if (!cancelled) setChannels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [installId]);

  useEffect(() => {
    if (!channelId) {
      setResolution(null);
      return;
    }
    setResolution({ channelId, text });
  }, [channelId, text, setResolution]);

  const focused = channels?.find(c => c.id === channelId);
  const channelLabel = focused ? `#${focused.name}` : channelId;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL}>Send test to</label>
          {channels === null ? (
            <div className="inline-flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 text-[12px] text-[color:var(--text-dim)]">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              loading channels…
            </div>
          ) : channels.length === 0 ? (
            <input
              type="text"
              value={channelId}
              onChange={e => setChannelId(e.target.value)}
              placeholder="C0123456789"
              className="w-full max-w-md rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 font-mono text-sm text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
            />
          ) : (
            <select
              value={channelId}
              onChange={e => setChannelId(e.target.value)}
              className="w-full max-w-md rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 text-sm text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
            >
              {channels.map(c => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                  {c.isPrivate ? ' (private)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL}>Message body</label>
          <textarea
            rows={4}
            value={text}
            maxLength={2000}
            onChange={e => setText(e.target.value)}
            className="w-full max-w-2xl rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 text-sm leading-relaxed text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
          />
          <span className="font-mono text-[10px] text-[color:var(--text-faint)]">
            {text.length} / 2000
          </span>
        </div>
      </div>

      {/* Slack-style preview — what the operator will see in {channel}.
          Markup mirrors the connected pane's bot-row rendering so the
          preview is faithful (avatar block, app badge, body, timestamp). */}
      <aside className="w-full max-w-md shrink-0 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className={FIELD_LABEL}>Preview · {channelLabel}</span>
          {teamName ? (
            <span className="font-mono text-[10px] text-[color:var(--text-faint)]">{teamName}</span>
          ) : null}
        </div>
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[color:color-mix(in_oklab,var(--ink)_85%,transparent)] font-display text-[14px] font-medium text-[color:var(--surface-base,#FDFBF7)]"
          >
            S
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-semibold text-[color:var(--ink)]">Sendero</span>
              <span className="rounded-sm bg-[color:color-mix(in_oklab,var(--ink)_10%,transparent)] px-1 font-mono text-[8.5px] uppercase tracking-[0.08em] text-[color:var(--text-dim)]">
                APP
              </span>
              <span className="font-mono text-[10px] text-[color:var(--text-faint)]">just now</span>
            </div>
            <p className="text-[13px] leading-relaxed text-[color:var(--ink)] whitespace-pre-wrap">
              {text || 'Type a message to preview…'}
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function HeaderWithHint({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`About ${label}`}
            className="inline-flex h-3 w-3 items-center justify-center text-[color:var(--text-faint)] transition-colors hover:text-[color:var(--ink)] focus:text-[color:var(--ink)] focus:outline-none"
          >
            <Info className="h-2.5 w-2.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs border border-[color:var(--hairline-color-soft)] bg-[color:var(--surface-raised)] text-xs normal-case tracking-normal text-[color:var(--ink)] shadow-none"
        >
          {hint}
        </TooltipContent>
      </Tooltip>
    </span>
  );
}
