'use client';

/**
 * /dashboard/integrations — index page mirroring `/dashboard/channels`.
 * One BigPill per integration. MCP and the Claude Code plugin are
 * shipping today; Bufi ships disabled with a "Coming soon" badge so
 * the third card slot exists at the same scale.
 *
 * Brand assets + Bufi metadata pulled from workspace packages so the
 * canonical sources stay reusable across surfaces:
 *  - `@sendero/icons` — McpMark + ClaudeCodePluginMark + BufiLogo
 *  - `@sendero/bu` — BUFI_PURPURA, BUFI_VIOLETA_WASH, BUFI_INTEGRATION
 */

import Link from 'next/link';

import { BUFI_INTEGRATION, BUFI_PURPURA, BUFI_VIOLETA_WASH } from '@sendero/bu';
import { BufiLogo, ClaudeCodePluginMark, McpMark } from '@sendero/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@sendero/ui/tooltip';

type IntegrationKind = 'mcp' | 'claude-code' | 'bufi';

export default function IntegrationsIndexPage() {
  return (
    <div className="flex w-full flex-col gap-6 px-2 pb-4 pt-0">
      <div className="flex flex-col items-center gap-6 pt-2">
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="max-w-md text-sm text-[color:var(--ink)]">
            Plug Sendero into the rest of your stack. Each integration is scoped to this workspace.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-8">
          <BigIntegrationPill
            href="/dashboard/integrations/mcp"
            kind="mcp"
            label="Manage MCP"
            description="One key powers HTTP dispatch, MCP server, and direct tool calls."
          />
          <BigIntegrationPill
            href="/dashboard/integrations/claude-code"
            kind="claude-code"
            label="Claude Code plugin"
            description="Versioned plugin bundle for Claude Code: Sendero MCP server + travel-booking skill, one install."
          />
          <BigIntegrationPill
            kind="bufi"
            label={BUFI_INTEGRATION.comingSoonLabel}
            description={BUFI_INTEGRATION.description}
            disabled
          />
        </div>
      </div>
    </div>
  );
}

function BigIntegrationPill({
  href,
  kind,
  label,
  description,
  disabled,
}: {
  href?: string;
  kind: IntegrationKind;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  // Each kind picks its own rest style + hover swap. MCP and Claude
  // Code share the warm parchment palette (vermillion ink). Bufi gets
  // the purpura-tinted brand wash so the disabled card still reads as
  // its own thing.
  const isInkBrand = kind === 'mcp' || kind === 'claude-code';

  const restStyle: React.CSSProperties = isInkBrand
    ? {
        background: '#ffffff',
        borderColor: 'color-mix(in oklab, var(--ink) 22%, transparent)',
      }
    : {
        background: `color-mix(in oklab, ${BUFI_VIOLETA_WASH} 55%, white)`,
        borderColor: `color-mix(in oklab, ${BUFI_PURPURA} 32%, transparent)`,
      };

  // Hover variables drive the brand swap on enabled cards. Tailwind
  // JIT can't compose dynamic arbitrary values from runtime constants,
  // so the hover transition lives in inline event handlers below.
  const labelColor = isInkBrand ? 'var(--ink)' : BUFI_PURPURA;

  const baseClass =
    'group/qa inline-flex h-[286px] w-[286px] flex-col items-center justify-center gap-[20px] rounded-[32px] border text-[color:var(--text-dim)] shadow-[var(--shadow-md)] transition-colors duration-150';

  let mark: React.ReactNode;
  if (kind === 'mcp') {
    mark = (
      <span style={{ color: 'var(--ink)' }} className="size-[192px] shrink-0">
        <McpMark size={192} />
      </span>
    );
  } else if (kind === 'claude-code') {
    mark = (
      <span style={{ color: 'var(--ink)' }} className="size-[192px] shrink-0">
        <ClaudeCodePluginMark size={192} />
      </span>
    );
  } else {
    mark = <BufiLogo size={192} className="size-[192px] shrink-0" />;
  }

  const content = (
    <>
      {mark}
      <span
        className="font-mono text-[22px] uppercase tracking-[0.14em]"
        style={{ color: labelColor }}
      >
        {label}
      </span>
      {disabled ? (
        <span
          className="font-mono text-[10px] uppercase tracking-[0.14em]"
          style={{ color: `color-mix(in oklab, ${BUFI_PURPURA} 70%, transparent)` }}
        >
          Coming soon
        </span>
      ) : null}
    </>
  );

  // Hover handlers swap border/background to the strong brand color
  // while the card is enabled. Disabled cards keep the static rest
  // style — the cursor + opacity already signal "not yet."
  const onEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (disabled) return;
    const el = e.currentTarget;
    if (isInkBrand) {
      el.style.background = 'color-mix(in oklab, var(--ink) 5%, white)';
      el.style.borderColor = 'var(--ink)';
    } else {
      el.style.background = BUFI_VIOLETA_WASH;
      el.style.borderColor = BUFI_PURPURA;
    }
  };
  const onLeave = (e: React.MouseEvent<HTMLElement>) => {
    if (disabled) return;
    const el = e.currentTarget;
    Object.assign(el.style, restStyle);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled || !href ? (
          <div
            aria-disabled
            aria-label={label}
            className={baseClass + ' cursor-not-allowed opacity-75'}
            style={restStyle}
          >
            {content}
          </div>
        ) : (
          <Link
            href={href}
            aria-label={label}
            className={baseClass}
            style={restStyle}
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
          >
            {content}
          </Link>
        )}
      </TooltipTrigger>
      {/* Topography variants match the dashboard CTA + brand-channel
          chips: ink (vermillion) for MCP + Claude Code, bufi (purpura)
          for Bufi. Same `topography.svg` mask system — the variant
          rule lives in `globals.css` keyed on `data-variant`. */}
      <TooltipContent
        side="bottom"
        data-variant={isInkBrand ? 'ink' : 'bufi'}
        className="max-w-xs text-xs"
      >
        <div className="font-medium">{label}</div>
        <div className="mt-0.5 text-[11px] opacity-90">{description}</div>
      </TooltipContent>
    </Tooltip>
  );
}
