'use client';

/**
 * ChannelDiagnosticCard — Stage artifact rendered when the operator
 * agent calls `inspect_my_whatsapp_channel` or `inspect_my_slack_channel`.
 *
 * Reuses `ChannelStatusPanel` (the same primitive as the channel hub
 * pages) for the install-state strip, then layers activity counters,
 * recent failures, and message previews.
 *
 * The tool's `message` string still answers the operator in the chat
 * column; this card is the "more thorough" view next to it.
 */

import {
  AlertTriangle,
  Inbox,
  Send,
  ShieldCheck,
  Hash,
  Plug,
  Building2,
  Users,
  ExternalLink,
} from 'lucide-react';

import { ChannelStatusPanel } from '@/components/channels/channel-status-panel';
import type {
  ChannelDiagnostic,
  ChannelDiagnosticActivity,
  ChannelDiagnosticFailure,
  ChannelDiagnosticInstallSummary,
  ChannelDiagnosticPreview,
} from '@/components/store';

const CONNECT_HREF: Record<ChannelDiagnostic['kind'], string> = {
  whatsapp: '/dashboard/channels/whatsapp',
  slack: '/dashboard/channels/slack',
};

function statusKindFor(install: ChannelDiagnosticInstallSummary) {
  if (!install.exists) return 'not_installed' as const;
  switch (install.status) {
    case 'active':
      return 'active' as const;
    case 'pending':
      return 'pending' as const;
    case 'disabled':
      return 'disabled' as const;
    case 'error':
      return 'error' as const;
    case 'revoked':
      return 'error' as const;
    default:
      return 'pending' as const;
  }
}

export function ChannelDiagnosticCard({ data }: { data: ChannelDiagnostic }) {
  const brand = data.kind;
  const install = data.install;
  const activity = data.activity;

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card-head">
        <span className="title">
          {brand === 'whatsapp' ? 'WhatsApp diagnostic' : 'Slack diagnostic'}
        </span>
        <span className="tag faint">
          last {activity?.hours ?? 24}h · refreshed {formatTime(data.refreshedAt)}
        </span>
      </div>

      <div style={{ padding: '0 16px' }}>
        <ChannelStatusPanel
          brand={brand}
          status={statusKindFor(install)}
          identifier={install.identifier ?? null}
          lastHealthyAt={install.updatedAt ?? null}
          lastErrorMessage={install.lastErrorMessage ?? null}
          connectHref={CONNECT_HREF[brand]}
        />
      </div>

      {install.exists ? <ConfigStrip brand={brand} install={install} /> : null}

      {activity ? <ActivityGrid brand={brand} activity={activity} /> : null}

      {data.identities || data.trips ? <PeopleGrid data={data} /> : null}

      {data.recentFailures && data.recentFailures.length > 0 ? (
        <FailuresList failures={data.recentFailures} />
      ) : null}

      {(data.recentInbound && data.recentInbound.length > 0) ||
      (data.recentOutbound && data.recentOutbound.length > 0) ? (
        <PreviewsBlock inbound={data.recentInbound ?? []} outbound={data.recentOutbound ?? []} />
      ) : null}

      <div style={{ padding: '8px 16px 14px' }}>
        <p className="t-body ink-70" style={{ fontSize: 12, lineHeight: 1.55, margin: 0 }}>
          {data.message}
        </p>
      </div>
    </div>
  );
}

function ConfigStrip({
  brand,
  install,
}: {
  brand: ChannelDiagnostic['kind'];
  install: ChannelDiagnosticInstallSummary;
}) {
  const items: Array<{ icon: React.ReactNode; label: string; ok: boolean; hint?: string }> =
    brand === 'whatsapp'
      ? [
          {
            icon: <Plug className="size-3" />,
            label: 'Kapso connection',
            ok: Boolean(install.hasKapsoConnection),
          },
          {
            icon: <Hash className="size-3" />,
            label: 'Meta phone number',
            ok: Boolean(install.hasMetaPhoneNumberId),
          },
          {
            icon: <Building2 className="size-3" />,
            label: 'Meta WABA',
            ok: Boolean(install.hasMetaWaba),
          },
        ]
      : [
          {
            icon: <Plug className="size-3" />,
            label: 'Bot token',
            ok: !install.revokedAt,
          },
          {
            icon: <Building2 className="size-3" />,
            label: install.isEnterpriseInstall ? 'Enterprise Grid' : 'Workspace install',
            ok: true,
          },
          {
            icon: <Hash className="size-3" />,
            label: install.defaultChannel
              ? `Default channel: ${install.defaultChannel}`
              : 'No default channel',
            ok: Boolean(install.routingConfigured),
          },
        ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 8,
        padding: '0 16px',
      }}
    >
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 10px',
            border: '1px solid var(--border)',
            background: 'var(--bg-elev)',
          }}
        >
          <span style={{ color: it.ok ? 'var(--accent-green)' : 'var(--text-faint)' }}>
            {it.icon}
          </span>
          <span
            className="t-mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: it.ok ? 'var(--text)' : 'var(--text-dim)',
            }}
          >
            {it.label}
          </span>
        </div>
      ))}
      {brand === 'slack' && install.scopes && install.scopes.length > 0 ? (
        <div
          style={{
            gridColumn: '1 / -1',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
            padding: '6px 0 0',
          }}
        >
          <span className="t-meta">scopes</span>
          {install.scopes.map(scope => (
            <span
              key={scope}
              className="t-mono"
              style={{
                fontSize: 9,
                padding: '1px 6px',
                background: 'color-mix(in oklab, var(--ink) 8%, transparent)',
                color: 'var(--ink)',
                borderRadius: 3,
                letterSpacing: '0.04em',
              }}
            >
              {scope}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActivityGrid({
  brand,
  activity,
}: {
  brand: ChannelDiagnostic['kind'];
  activity: ChannelDiagnosticActivity;
}) {
  const cells: Array<{
    icon: React.ReactNode;
    label: string;
    value: string;
    hint?: string;
    tone?: 'normal' | 'verm';
  }> =
    brand === 'whatsapp'
      ? [
          {
            icon: <Inbox className="size-3" />,
            label: 'Inbound',
            value: String(activity.inboundMessages ?? 0),
            hint: `${activity.webhookEvents ?? 0} webhook events`,
          },
          {
            icon: <Send className="size-3" />,
            label: 'Outbound',
            value: String(activity.outboundTotal ?? 0),
            hint: `${activity.delivered ?? 0} delivered · ${activity.read ?? 0} read`,
          },
          {
            icon: <AlertTriangle className="size-3" />,
            label: 'Failed sends',
            value: String(activity.failed ?? 0),
            tone: (activity.failed ?? 0) > 0 ? 'verm' : 'normal',
            hint:
              (activity.droppedReplay ?? 0) + (activity.droppedDuplicate ?? 0) > 0
                ? `${activity.droppedReplay ?? 0} replay · ${activity.droppedDuplicate ?? 0} dup`
                : 'no replay/dup drops',
          },
          {
            icon: <ShieldCheck className="size-3" />,
            label: 'API calls',
            value: String(activity.apiTotal ?? 0),
            tone: (activity.apiErrored ?? 0) > 0 ? 'verm' : 'normal',
            hint: `${activity.apiOk ?? 0} ok · ${activity.apiErrored ?? 0} errored`,
          },
        ]
      : [
          {
            icon: <Inbox className="size-3" />,
            label: 'Inbound',
            value: String(activity.inboundMessages ?? 0),
            hint: 'from Trip.events',
          },
          {
            icon: <Send className="size-3" />,
            label: 'Agent replies',
            value: String(activity.agentReplies ?? 0),
          },
          {
            icon: <ShieldCheck className="size-3" />,
            label: 'Metered',
            value: String(activity.meteredReplies ?? 0),
            hint: 'chat_reply rows',
          },
          {
            icon: <Hash className="size-3" />,
            label: 'Window',
            value: `${activity.hours}h`,
          },
        ];

  return (
    <div className="settle-grid" style={{ borderTop: '1px solid var(--border)' }}>
      {cells.map((c, i) => (
        <div
          key={i}
          className="settle-cell"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <span
            className="k"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              color: c.tone === 'verm' ? 'var(--vermillion)' : 'var(--text-dim)',
            }}
          >
            {c.icon}
            {c.label}
          </span>
          <span
            className="v"
            style={{
              color: c.tone === 'verm' ? 'var(--vermillion)' : 'var(--text)',
            }}
          >
            {c.value}
          </span>
          {c.hint ? <span className="k">{c.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}

function PeopleGrid({ data }: { data: ChannelDiagnostic }) {
  const ids = data.identities;
  const trips = data.trips;
  const idCount = data.kind === 'whatsapp' ? (ids?.totalActive ?? 0) : (ids?.boundUsers ?? 0);
  const idLabel = data.kind === 'whatsapp' ? 'Channel identities' : 'Bound users';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 8,
        padding: '0 16px',
      }}
    >
      <CompactKpi icon={<Users className="size-3" />} label={idLabel} value={String(idCount)} />
      <CompactKpi
        icon={<Hash className="size-3" />}
        label="Active linked trips"
        value={String(trips?.activeLinked ?? 0)}
      />
    </div>
  );
}

function CompactKpi({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        border: '1px solid var(--border)',
        background: 'var(--bg-elev)',
      }}
    >
      <span style={{ color: 'var(--text-dim)' }}>{icon}</span>
      <span
        className="t-mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
          flex: 1,
        }}
      >
        {label}
      </span>
      <span
        className="t-mono"
        style={{
          fontSize: 13,
          color: 'var(--text)',
          fontWeight: 600,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function FailuresList({ failures }: { failures: ChannelDiagnosticFailure[] }) {
  return (
    <div style={{ padding: '0 16px' }}>
      <div
        className="t-mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.08em',
          color: 'var(--vermillion)',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        Recent failures ({failures.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {failures.map((f, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '70px 1fr auto',
              gap: 8,
              padding: '6px 10px',
              border: '1px solid var(--border)',
              background: 'color-mix(in oklab, var(--vermillion) 4%, var(--bg-elev))',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
            }}
          >
            <span style={{ color: 'var(--text-dim)' }}>{formatTime(f.at)}</span>
            <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {f.recipient} · <span style={{ color: 'var(--text-dim)' }}>{f.source}</span>
            </span>
            <span style={{ color: 'var(--vermillion)' }}>{truncate(f.reason, 40)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewsBlock({
  inbound,
  outbound,
}: {
  inbound: ChannelDiagnosticPreview[];
  outbound: ChannelDiagnosticPreview[];
}) {
  return (
    <div style={{ padding: '0 16px 4px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {inbound.length > 0 ? (
        <PreviewColumn
          label="Recent inbound"
          icon={<Inbox className="size-3" />}
          items={inbound}
          tint="ink"
        />
      ) : null}
      {outbound.length > 0 ? (
        <PreviewColumn
          label="Recent outbound"
          icon={<Send className="size-3" />}
          items={outbound}
          tint="sea"
        />
      ) : null}
    </div>
  );
}

function PreviewColumn({
  label,
  icon,
  items,
  tint,
}: {
  label: string;
  icon: React.ReactNode;
  items: ChannelDiagnosticPreview[];
  tint: 'ink' | 'sea';
}) {
  const accent = tint === 'ink' ? 'var(--ink)' : 'var(--sendero-sea, #0f7c82)';
  return (
    <div>
      <div
        className="t-mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.08em',
          color: 'var(--text-dim)',
          textTransform: 'uppercase',
          marginBottom: 6,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {icon}
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((it, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '70px 1fr',
              gap: 8,
              padding: '6px 10px',
              border: '1px solid var(--border)',
              background: 'var(--bg-elev)',
              borderLeft: `2px solid ${accent}`,
              fontSize: 12,
            }}
          >
            <span
              className="t-mono"
              style={{ fontSize: 10, color: 'var(--text-dim)', alignSelf: 'start' }}
            >
              {formatTime(it.at)}
            </span>
            <span style={{ color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{it.preview}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toTimeString().slice(0, 5);
  } catch {
    return iso;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// Lucide ExternalLink isn't used in this file directly but kept imported
// to keep ChannelStatusPanel's bundle co-located in the chunk.
void ExternalLink;
