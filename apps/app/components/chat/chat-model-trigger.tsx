'use client';

/**
 * Compact model-selector trigger used at the top of `/dashboard/console`
 * and `/dashboard/agent-chat`. Same widget, same persisted state via
 * `useChatModel`.
 *
 * Rebuilt for the credits + COGS plan:
 *
 * - Single source of truth: `CHAT_MODEL_COGS` from `@sendero/billing/cogs`.
 *   No more local `CHAT_MODEL_OPTIONS` list — when a new model registers,
 *   the picker picks it up automatically.
 *
 * - **Tier dots** (●●○○○) replace predictive `$/turn` numbers. The Design
 *   subagent flagged single-number $/turn displays as a CRITICAL trust
 *   risk because real per-turn cost varies 5-10× cached vs. uncached and
 *   4k vs. 32k context. Dots show the relative cost band without claiming
 *   a specific number to be wrong about.
 *
 * - **Locked rows** stay visible (visibility is the upsell) but render
 *   OUT of the radio group with `aria-disabled` and a trailing
 *   "Upgrade to {tier}" Badge. Click on a locked row deep-links to
 *   `/dashboard/settings/billing?upgrade={tier}&model={id}` so the
 *   upgrade page can render contextual copy.
 *
 * - **HoverCard popover** surfaces the model description sourced from
 *   the gateway's model card (when `cogs.description` is non-null).
 *   Models without a registered description fall back cleanly to a
 *   bare row — no fake content invented to fill the field.
 *
 * - **useChatModel silent fallback**: if the persisted model is now
 *   locked (e.g. tenant downgraded), select the highest-priced allowed
 *   model on first render and write it back to localStorage.
 */

import { useCallback, useEffect, useMemo } from 'react';

import { Lock } from 'lucide-react';
import Link from 'next/link';

import {
  CHAT_MODEL_COGS,
  type ChatModelCogs,
  type ChatModelProvider,
  isModelAllowedByCap,
  PLANS,
  type PlanTier,
} from '@sendero/billing';
import { ProviderIcon, type ProviderSlug } from '@sendero/icons/providers';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatModel } from '@/hooks/use-chat-model';

// Provider → ProviderSlug mapping. The COGS registry uses the same
// three values (`anthropic | openai | google`) but the type names
// differ at the import boundary; this assertion is safe because both
// types share the exact same string union.
function providerSlug(p: ChatModelProvider): ProviderSlug {
  return p as ProviderSlug;
}

const TIER_ORDER: readonly PlanTier[] = ['free', 'basic', 'pro', 'enterprise'] as const;

/**
 * Five-band cost dot encoding. Logarithmic scale across the
 * full model range (Flash ~5k → Opus 4.7 ~290k micro/turn):
 *   ●○○○○  ≤  8k  — free-tier flash / mini
 *   ●●○○○  ≤ 30k  — haiku, gpt-5, gemini-pro
 *   ●●●○○  ≤ 60k  — sonnet 4.5 / 4.6
 *   ●●●●○  ≤ 210k — opus 4.1  (pro ceiling)
 *   ●●●●●  > 210k — opus 4.7  (enterprise only)
 */
export function tierDots(cogsMicro: bigint): string {
  if (cogsMicro <= 8_000n) return '●○○○○';
  if (cogsMicro <= 30_000n) return '●●○○○';
  if (cogsMicro <= 60_000n) return '●●●○○';
  if (cogsMicro <= 210_000n) return '●●●●○';
  return '●●●●●';
}

/** Lowest tier whose `maxCostPerTurnMicro` would unlock the model. */
function requiredTierFor(cogsMicro: bigint, currentTier: PlanTier): PlanTier {
  const startIdx = TIER_ORDER.indexOf(currentTier) + 1;
  for (let i = startIdx; i < TIER_ORDER.length; i++) {
    const t = TIER_ORDER[i];
    const cap = PLANS[t].maxCostPerTurnMicro;
    if (cap === null) return t;
    if (cogsMicro <= cap) return t;
  }
  return 'enterprise';
}

/** Tier-specific upgrade CTA copy per the Design subagent recommendation. */
function upgradeCtaLabel(requiredTier: PlanTier): string {
  switch (requiredTier) {
    case 'basic':
      return 'Add for $19/mo';
    case 'pro':
      return 'Unlock with Pro';
    case 'enterprise':
      return 'Talk to sales';
    default:
      return `Upgrade to ${requiredTier}`;
  }
}

/** Group models by provider — preserves COGS-registry sort within each group. */
function groupByProvider(models: ChatModelCogs[]): Map<ChatModelProvider, ChatModelCogs[]> {
  const out = new Map<ChatModelProvider, ChatModelCogs[]>();
  for (const m of models) {
    const list = out.get(m.provider) ?? [];
    list.push(m);
    out.set(m.provider, list);
  }
  return out;
}

const PROVIDER_LABEL: Record<ChatModelProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
};

export interface ChatModelTriggerProps {
  /**
   * The tenant's current plan tier. Determines which models are visibly
   * unlocked. Defaults to `free` for safety — server-side gating is the
   * source of truth, this just drives picker UX.
   */
  tier?: PlanTier;
}

export function ChatModelTrigger({ tier = 'free' }: ChatModelTriggerProps) {
  const [model, setModel] = useChatModel();

  const cap = PLANS[tier].maxCostPerTurnMicro;
  const selected = useMemo(
    () => CHAT_MODEL_COGS.find(m => m.id === model) ?? CHAT_MODEL_COGS[0],
    [model]
  );

  // Silent fallback: if the persisted model is now locked (tenant
  // downgraded mid-cycle, plan policy changed), pick the most expensive
  // allowed model and write it back. The `useEffect` runs once on mount
  // after `useChatModel` hydrates from localStorage.
  useEffect(() => {
    if (!isModelAllowedByCap(model, cap)) {
      const fallback = [...CHAT_MODEL_COGS].filter(m => isModelAllowedByCap(m.id, cap)).pop();
      if (fallback) setModel(fallback.id);
    }
  }, [model, cap, setModel]);

  const onValueChange = useCallback(
    (id: string) => {
      // Defensive: even though locked rows are not in the radio group,
      // protect against future regressions or programmatic selection.
      if (!isModelAllowedByCap(id, cap)) return;
      setModel(id);
    },
    [cap, setModel]
  );

  const allowedSet = useMemo(
    () => new Set(CHAT_MODEL_COGS.filter(m => isModelAllowedByCap(m.id, cap)).map(m => m.id)),
    [cap]
  );

  const grouped = useMemo(() => groupByProvider(CHAT_MODEL_COGS), []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Chat model: ${selected.name}`}
          className="sd-corner-hover inline-flex items-center gap-2 rounded-md border-[color:var(--hairline-color-soft)] bg-[color:var(--surface-raised)] px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[color:var(--ink)] shadow-none hover:border-[color:var(--hairline-color-strong)] hover:bg-[color:var(--surface-raised)]"
        >
          <ProviderIcon slug={providerSlug(selected.provider)} size={14} />
          <span>{selected.name}</span>
          <span
            aria-hidden
            className="ml-1 font-mono text-[9px] tracking-[0.2em] text-[color:var(--midnight)]/55"
          >
            {tierDots(selected.cogsPerTurnMicro)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-72 border border-[color:var(--hairline-color-soft)] bg-[color:var(--surface-raised)]"
      >
        <DropdownMenuLabel className="flex items-center justify-between pl-8 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          <span>Model</span>
          <span>Cost / turn</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={model} onValueChange={onValueChange}>
          {Array.from(grouped.entries()).map(([provider, models], providerIdx) => (
            <DropdownMenuGroup key={provider}>
              {providerIdx > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                {PROVIDER_LABEL[provider]}
              </DropdownMenuLabel>
              {models.map(m => {
                const allowed = allowedSet.has(m.id);
                const dots = tierDots(m.cogsPerTurnMicro);
                const requiredTier = !allowed ? requiredTierFor(m.cogsPerTurnMicro, tier) : null;

                // Inner row content — wrapped in HoverCard ONLY when a
                // description is registered. Models without a description
                // render the same row content directly (no popover) so
                // there's no empty hover with nothing to say.
                const rowContent = (
                  <>
                    <ProviderIcon slug={providerSlug(m.provider)} size={14} />
                    <span className="flex-1 truncate text-[12px]">{m.name}</span>
                    <span
                      aria-hidden
                      className="ml-1 font-mono text-[9px] tracking-[0.2em] text-[color:var(--midnight)]/55"
                    >
                      {dots}
                    </span>
                    {!allowed && requiredTier ? (
                      <Badge
                        variant="outline"
                        className="ml-2 border-[color:var(--hairline-color)] bg-transparent px-1.5 py-0 text-[9px] font-normal uppercase tracking-[0.08em]"
                      >
                        <Lock className="mr-1 h-2.5 w-2.5" aria-hidden />
                        {upgradeCtaLabel(requiredTier)}
                      </Badge>
                    ) : null}
                  </>
                );

                const wrapInPopover = (children: React.ReactNode) =>
                  m.description ? (
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>{children}</TooltipTrigger>
                        <TooltipContent
                          side="right"
                          align="start"
                          className="w-72 max-w-none border border-[color:var(--ink)] bg-[color:var(--surface-floating)] p-3 text-[color:var(--midnight)] shadow-[0_4px_16px_rgba(31,42,68,0.12)]"
                        >
                          <div className="mb-1.5 flex items-center gap-2">
                            <span className="opacity-40">
                              <ProviderIcon slug={providerSlug(m.provider)} size={13} />
                            </span>
                            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] opacity-60">
                              {PROVIDER_LABEL[m.provider]} · cost {dots}
                            </span>
                          </div>
                          <p className="text-[11.5px] leading-relaxed opacity-75">
                            {m.description}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <>{children}</>
                  );

                if (allowed) {
                  return wrapInPopover(
                    <DropdownMenuRadioItem
                      key={m.id}
                      value={m.id}
                      className="gap-2 pl-8 [&>span:first-child]:left-2"
                    >
                      {rowContent}
                    </DropdownMenuRadioItem>
                  );
                }

                // Locked row: NOT a radio item. Renders as a non-checkable
                // menu item that links to the upgrade page on click.
                // `aria-disabled` keeps the radio-group keyboard semantics
                // intact for screen readers.
                return wrapInPopover(
                  <DropdownMenuItem
                    key={m.id}
                    asChild
                    aria-disabled
                    className="gap-2 pl-8 opacity-60 [&>span:first-child]:left-2"
                  >
                    <Link
                      href={`/dashboard/settings/billing?upgrade=${requiredTier}&model=${encodeURIComponent(m.id)}`}
                      aria-label={`${m.name} requires ${requiredTier} tier — click to upgrade`}
                    >
                      {rowContent}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Legacy compatibility export — old callers imported `CHAT_MODEL_OPTIONS`
 * from this module. Re-derive the shape from the new COGS registry so
 * any references continue to compile while we migrate.
 *
 * @deprecated Import directly from `@sendero/billing` (`CHAT_MODEL_COGS`)
 *  — that's the source of truth.
 */
export interface ChatModelOption {
  id: string;
  name: string;
  chef: 'Google' | 'Anthropic' | 'OpenAI';
  chefSlug: ProviderSlug;
}

const PROVIDER_TO_CHEF: Record<ChatModelProvider, ChatModelOption['chef']> = {
  google: 'Google',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

export const CHAT_MODEL_OPTIONS: ChatModelOption[] = CHAT_MODEL_COGS.map(m => ({
  id: m.id,
  name: m.name,
  chef: PROVIDER_TO_CHEF[m.provider],
  chefSlug: providerSlug(m.provider),
}));
