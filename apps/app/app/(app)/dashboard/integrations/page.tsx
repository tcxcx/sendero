'use client';

/**
 * /dashboard/integrations — index page mirroring `/dashboard/channels`.
 * One BigPill per integration. MCP is the only working integration
 * today; Bufi ships disabled with a "Coming soon" badge so the second
 * card slot exists at the same scale as the first.
 *
 * Visual contract is the same as channels (286×286 card, 192×192 brand
 * mark, mono uppercase label). Each card carries its brand color in
 * border + hover wash:
 *  - MCP: ink (--ink, vermillion)
 *  - Bufi: #6854CF "purpura" with #C4A1FF "violeta" accent
 *    (canonical brand palette from desk-v1 invoice templates)
 */

import Link from 'next/link';

import { Tooltip, TooltipContent, TooltipTrigger } from '@sendero/ui/tooltip';

// Bufi brand palette, shipped here as inline-tailwind values so the
// card carries the brand identity even on the disabled state.
const BUFI_PURPURA = '#6854CF';
const BUFI_VIOLETA_WASH = '#F0E9FF';

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

/**
 * Inline MCP brand mark from the official ModelContextProtocol SVG.
 * Inlined (vs. <img src=mcp.svg>) so `currentColor` actually inherits
 * from the parent's CSS color — img tags don't propagate CSS color
 * into externally-loaded SVG documents.
 */
function McpMark({ size = 192 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden
      className="shrink-0"
    >
      <title>ModelContextProtocol</title>
      <path d="M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z" />
      <path d="M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z" />
    </svg>
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

  // Static styles per brand. MCP keeps the warm parchment border that
  // matches /channels. Bufi gets a purpura-tinted border + soft violeta
  // wash so the disabled card still carries brand identity.
  const restStyle: React.CSSProperties = isMcp
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
  const labelColor = isMcp ? 'var(--ink)' : BUFI_PURPURA;

  const baseClass =
    'group/qa inline-flex h-[286px] w-[286px] flex-col items-center justify-center gap-[20px] rounded-[32px] border text-[color:var(--text-dim)] shadow-[var(--shadow-md)] transition-colors duration-150';

  const content = (
    <>
      {isMcp ? (
        <span style={{ color: 'var(--ink)' }} className="size-[192px] shrink-0">
          <McpMark size={192} />
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- brand mark, no next/image transcoding
        <img
          src="/brand/integrations/bufi.png"
          alt=""
          width={192}
          height={192}
          className="size-[192px] shrink-0"
          aria-hidden="true"
        />
      )}
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
    if (isMcp) {
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
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        <div className="font-medium">{label}</div>
        <div className="mt-0.5 text-[11px] opacity-90">{description}</div>
      </TooltipContent>
    </Tooltip>
  );
}
