'use client';

/**
 * SlackChannelTabs — page-level tabs at /dashboard/channels/slack.
 *
 *   Tab 1 "Workspace": connected SlackInstall panel(s) — the operator's
 *   current state, routing table, disconnect + per-channel leave controls.
 *
 *   Tab 2 "Share install URL": the public install URL share card —
 *   copy/preview/mailto + checklist + how-it-works expander. Surfaces only
 *   when the operator wants to share with a corporate client.
 *
 * Server-rendered children stay as-is — this component is just a thin
 * client wrapper that hides the inactive panel. Avoids hoisting the
 * whole page to client and keeps RSC streaming for the panel content.
 *
 * Default tab is "workspace" because most visits are check-state /
 * configure-routing, not "I'm here to onboard a new client" — that
 * happens once per client, not every dashboard refresh.
 */

import { useState } from 'react';

import { PillTabs } from '@sendero/ui/pill-tabs';

type SlackTabValue = 'workspace' | 'share';

const TABS = [
  { value: 'workspace' as const, label: 'Workspace' },
  { value: 'share' as const, label: 'Share install URL' },
] as const;

interface SlackChannelTabsProps {
  workspaceContent: React.ReactNode;
  shareContent: React.ReactNode;
}

export function SlackChannelTabs({ workspaceContent, shareContent }: SlackChannelTabsProps) {
  const [tab, setTab] = useState<SlackTabValue>('workspace');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PillTabs<SlackTabValue>
        id="slack-channel-tabs"
        ariaLabel="Slack channel views"
        tabs={TABS}
        value={tab}
        onChange={setTab}
      />
      {/* Render both subtrees — toggle visibility via display so server-
          rendered children's data fetches happen once and tab swaps are
          instant. The hidden subtree stays in the DOM but is not painted. */}
      <div style={{ display: tab === 'workspace' ? 'contents' : 'none' }}>{workspaceContent}</div>
      <div style={{ display: tab === 'share' ? 'contents' : 'none' }}>{shareContent}</div>
    </div>
  );
}
