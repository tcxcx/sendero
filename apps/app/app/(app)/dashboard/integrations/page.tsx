/**
 * /dashboard/integrations — index page mirroring `/dashboard/channels`.
 * One BigPill per integration. MCP is the only working integration
 * today; Bufi ships disabled with a "Coming soon" badge so the second
 * card slot exists at the same scale as the first.
 *
 * Visual contract is the same as channels (286×286 card, 192×192 brand
 * mark, mono uppercase label) so the breadcrumb-driven landing reads
 * as a sibling to the channels picker.
 */

import Link from 'next/link';

import { Tooltip, TooltipContent, TooltipTrigger } from '@sendero/ui/tooltip';

export default function IntegrationsIndexPage() {
  return (
    <div className="flex w-full flex-col gap-6 px-2 pb-4 pt-0">
      <div className="flex flex-col items-center gap-6 pt-2">
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="max-w-md text-sm text-[color:var(--ink)]">
            Plug Sendero into the rest of your stack. Each integration is scoped to this workspace.
          </p>
        </div>

        <div className="flex flex-nowrap items-center justify-center gap-8">
          <BigIntegrationPill
            href="/dashboard/integrations/mcp"
            kind="mcp"
            label="Manage MCP"
            description="One key powers HTTP dispatch, MCP server, and direct tool calls."
          />
          <BigIntegrationPill
            kind="bufi"
            label="Coming soon"
            description="Bufi balance + payouts inside the operator console. Wait-listed for now."
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
  kind: 'mcp' | 'bufi';
  label: string;
  description: string;
  disabled?: boolean;
}) {
  const isMcp = kind === 'mcp';
  const logoSrc = isMcp ? '/brand/integrations/mcp.svg' : '/brand/integrations/bufi.png';
  // Hover chrome only fires on enabled cards. MCP picks an ink-tinted
  // border + a faint vermillion wash; Bufi card stays inert.
  const hoverChrome = disabled
    ? ''
    : 'hover:border-[color:var(--ink)] hover:bg-[color:color-mix(in_oklab,var(--ink)_5%,white)]';

  const baseClass =
    'group/qa inline-flex h-[286px] w-[286px] flex-col items-center justify-center gap-[20px] rounded-[32px] ' +
    'border border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] ' +
    'bg-white text-[color:var(--text-dim)] shadow-[var(--shadow-md)] ' +
    'transition-colors duration-150 ' +
    hoverChrome;

  const content = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- brand mark, no next/image transcoding */}
      <img
        src={logoSrc}
        alt=""
        width={192}
        height={192}
        className="size-[192px] shrink-0"
        style={isMcp ? { color: 'var(--ink)' } : undefined}
        aria-hidden="true"
      />
      <span className="font-mono text-[22px] uppercase tracking-[0.14em] text-[color:var(--ink)]">
        {label}
      </span>
      {disabled ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:color-mix(in_oklab,var(--midnight)_60%,transparent)]">
          Coming soon
        </span>
      ) : null}
    </>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled || !href ? (
          <div
            aria-disabled
            aria-label={label}
            className={baseClass + ' cursor-not-allowed opacity-60'}
          >
            {content}
          </div>
        ) : (
          <Link href={href} aria-label={label} className={baseClass}>
            {content}
          </Link>
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        <div className="font-medium">{label}</div>
        <div className="mt-0.5 text-[11px] opacity-90">{description}</div>
      </TooltipContent>
    </Tooltip>
  );
}
