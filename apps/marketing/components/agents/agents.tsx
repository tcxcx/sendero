'use client';

/**
 * Sendero /agents — verbatim port of midday-ai/midday's agents page
 * (apps/website/src/components/agents.tsx) with Sendero swaps:
 *
 * - Wordmark "sendero" instead of "midday"
 * - Scenarios: Search & hold / Confirm & settle / Reconcile / Audit
 * - Copy: travel ops + USDC settlement + MCP-native
 * - Brand backdrop: Sendero ink (#1f2a44) — already a deep navy that
 *   matches the Midday aesthetic without further tuning. Tokens are
 *   injected at page level via `dangerouslySetInnerHTML` (see
 *   apps/marketing/app/agents/page.tsx) so the rest of the marketing
 *   site stays parchment-on-ink.
 *
 * Same component contract as Midday's: takes `pixelFontClass` from
 * `geist/font/pixel` so the giant "sendero" wordmark inside the
 * terminal renders in pixel type.
 */

import { Check, Copy } from 'lucide-react';
import Link from 'next/link';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { McpInstaller } from '@sendero/ui/mcp-installer';

const SENDERO_MCP_URL = 'https://app.sendero.travel/api/mcp';
const SENDERO_API_KEYS_URL = 'https://app.sendero.travel/dashboard/settings/api-keys';

function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

function SectionDivider() {
  return (
    <div className="w-full py-1">
      <div
        className="h-4 w-full border-y border-border"
        style={{
          backgroundImage:
            'repeating-linear-gradient(-60deg, hsla(var(--border), 0.4), hsla(var(--border), 0.4) 1px, transparent 1px, transparent 6px)',
        }}
      />
    </div>
  );
}

function CopyInstall() {
  const [copied, setCopied] = useState(false);

  const copyCommand = () => {
    navigator.clipboard.writeText('npx @sendero/cli@latest').catch(() => {
      // Best-effort
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };

  return (
    /*
      Hover inversion as a group: the whole button (background +
      hatched fill + command text + copy icon) flips to ink-on-
      parchment in one move. `group` + `group-hover:` keeps the
      children in lockstep so the icon doesn't lag behind the bg.
    */
    <button
      type="button"
      onClick={copyCommand}
      className="copy-install group relative flex w-full cursor-pointer items-center border border-border bg-transparent p-2 px-4 text-sm transition-colors duration-150 hover:bg-[var(--fg)] hover:!border-[var(--fg)]"
    >
      <span className="truncate text-foreground transition-colors duration-150 group-hover:text-[var(--bg)]">
        $ npx @sendero/cli@latest
      </span>

      <div className="ml-auto flex items-center space-x-2">
        {copied ? (
          <Check
            size={14}
            className="text-foreground transition-colors duration-150 group-hover:text-[var(--bg)]"
          />
        ) : (
          <Copy
            size={14}
            className="text-foreground transition-colors duration-150 group-hover:text-[var(--bg)]"
          />
        )}
      </div>

      {copied && (
        <div className="absolute left-1/2 -top-7 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-1 text-xs text-foreground">
          Copied
        </div>
      )}
    </button>
  );
}

const ORA_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

type Phase = 'typing-1' | 'spin-1' | 'result-1' | 'typing-2' | 'spin-2' | 'result-2' | 'done';

const PHASES: Phase[] = [
  'typing-1',
  'spin-1',
  'result-1',
  'typing-2',
  'spin-2',
  'result-2',
  'done',
];

type Scenario = {
  label: string;
  cmd1: string;
  cmd2: string;
  spin1: string;
  spin2: string;
  done2: string;
  result1: React.ReactNode;
  result2Line: string;
};

const SCENARIOS: Scenario[] = [
  {
    label: 'Search & hold',
    cmd1: 'sendero tools call search_flights \'{"origin":"BUE","destination":"MIA","date":"2026-05-12"}\'',
    cmd2: 'sendero tools call hold \'{"offerId":"off_8f2","holdMinutes":1440}\'',
    spin1: 'Searching flights via Duffel...',
    spin2: 'Placing 24h hold...',
    done2: 'Hold confirmed.',
    result1: (
      <div className="relative mt-3 border-[0.5px] border-primary text-foreground text-[12px]">
        <span
          className="absolute -top-[10px] left-3 px-1.5 text-[11px] tracking-wide text-foreground"
          style={{ background: '#15110d' }}
        >
          BUE → MIA · 12 May 2026 · 3 offers
        </span>
        <table className="w-full mt-2 mb-1">
          <thead>
            <tr className="text-left border-b-[0.5px] border-primary">
              <th className="font-normal pl-3 pr-2 pb-1 text-foreground">CARRIER</th>
              <th className="font-normal pr-2 pb-1 text-foreground">DEPART</th>
              <th className="font-normal pr-2 pb-1 text-foreground">CABIN</th>
              <th className="font-normal pr-3 pb-1 text-right text-foreground">FARE</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="pl-3 pr-2 py-[3px]">AA · off_8f2</td>
              <td className="pr-2 py-[3px]">23:55 BUE</td>
              <td className="pr-2 py-[3px]">Refundable</td>
              <td className="pr-3 py-[3px] text-right">$842.00</td>
            </tr>
            <tr>
              <td className="pl-3 pr-2 py-[3px]">LA · off_8f3</td>
              <td className="pr-2 py-[3px]">22:10 BUE</td>
              <td className="pr-2 py-[3px]">Standard</td>
              <td className="pr-3 py-[3px] text-right">$617.00</td>
            </tr>
            <tr>
              <td className="pl-3 pr-2 py-[3px]">UA · off_8f4</td>
              <td className="pr-2 py-[3px]">07:25 BUE+1</td>
              <td className="pr-2 py-[3px]">Refundable</td>
              <td className="pr-3 py-[3px] text-right">$1,124.00</td>
            </tr>
          </tbody>
        </table>
        <div className="px-3 pb-2 text-[11px] text-foreground">Held offer: off_8f2</div>
      </div>
    ),
    result2Line: '  Hold lives 24h · expires 2026-04-29 18:20 UTC',
  },
  {
    label: 'Confirm & settle',
    cmd1: 'sendero tools call confirm_booking \'{"holdId":"hold_a1b","payerWallet":"treasury"}\'',
    cmd2: 'sendero tools call settle_invoice \'{"bookingId":"bk_5c1"}\'',
    spin1: 'Ticketing offer + writing on-chain audit row...',
    spin2: 'Settling commission to take-rate wallet...',
    done2: 'Settlement landed in block 412,839,221.',
    result1: (
      <div className="mt-2 text-foreground text-[12px] space-y-0.5">
        <div> Booking confirmed: bk_5c1</div>
        <div> PNR: PJZ3M1</div>
        <div> Settlement: $842.00 USDC → carrier wallet</div>
        <div> Take-rate: $4.21 USDC (50bps, Pro plan -10%)</div>
        <div> On-chain audit: arcscan.io/tx/0x4f…a17</div>
      </div>
    ),
    result2Line: '  Commission settled · meter event mev_7e9 booked.',
  },
  {
    label: 'Reconcile',
    cmd1: 'sendero tools call list_unmatched_settlements',
    cmd2: 'sendero tools call match_settlements --auto',
    spin1: 'Pulling settlements without paired bookings...',
    spin2: 'Auto-matching by holdId + amount...',
    done2: 'Matching 3 settlements to bookings...',
    result1: (
      <div className="relative mt-3 border-[0.5px] border-primary text-foreground text-[12px]">
        <span
          className="absolute -top-[10px] left-3 px-1.5 text-[11px] tracking-wide text-foreground"
          style={{ background: '#15110d' }}
        >
          Unmatched settlements [3]
        </span>
        <table className="w-full mt-2 mb-1">
          <thead>
            <tr className="text-left border-b-[0.5px] border-primary">
              <th className="font-normal pl-3 pr-2 pb-1 text-foreground">ID</th>
              <th className="font-normal pr-2 pb-1 text-foreground">CHAIN</th>
              <th className="font-normal pr-2 pb-1 text-right text-foreground">AMOUNT</th>
              <th className="font-normal pr-3 pb-1 text-foreground">SUGGESTED</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="pl-3 pr-2 py-[3px]">stl_91a</td>
              <td className="pr-2 py-[3px]">arc</td>
              <td className="pr-2 py-[3px] text-right">$842.00</td>
              <td className="pr-3 py-[3px]">bk_5c1</td>
            </tr>
            <tr>
              <td className="pl-3 pr-2 py-[3px]">stl_8e7</td>
              <td className="pr-2 py-[3px]">arc</td>
              <td className="pr-2 py-[3px] text-right">$617.00</td>
              <td className="pr-3 py-[3px]">bk_5b9</td>
            </tr>
            <tr>
              <td className="pl-3 pr-2 py-[3px]">stl_8d2</td>
              <td className="pr-2 py-[3px]">base</td>
              <td className="pr-2 py-[3px] text-right">$305.50</td>
              <td className="pr-3 py-[3px]">bk_5a4</td>
            </tr>
          </tbody>
        </table>
      </div>
    ),
    result2Line: '  Matched 3/3 settlements. Ledger reconciled.',
  },
  {
    label: 'Audit',
    cmd1: 'sendero tools call export_trip_summary \'{"tripId":"tr_4d9","format":"pdf"}\'',
    cmd2: 'sendero tools call export_audit_log \'{"period":"2026-Q2","format":"csv"}\'',
    spin1: 'Rendering trip summary PDF...',
    spin2: 'Streaming audit log to CSV...',
    done2: 'Export complete.',
    result1: (
      <div className="mt-2 text-foreground text-[12px] space-y-0.5">
        <div> Trip: tr_4d9 (BUE → MIA → LIM, 5 legs)</div>
        <div> Travelers: 3 · Bookings: 7 · Holds: 2</div>
        <div> Total spend: $4,217.50 USDC</div>
        <div> Audit URL: app.sendero.travel/exports/tr_4d9.pdf</div>
        <div> Arcscan trail: 7 settlements indexed</div>
      </div>
    ),
    result2Line: '  Q2 audit log: 142 events · 87 settlements · 3.1 MB CSV.',
  },
];

function Terminal({ pixelFontClass }: { pixelFontClass?: string }) {
  const [activeTab, setActiveTab] = useState(0);
  const [phase, setPhase] = useState<Phase>('typing-1');
  const [typed1, setTyped1] = useState('');
  const [typed2, setTyped2] = useState('');
  const [frame, setFrame] = useState(0);
  const [cursorOn, setCursorOn] = useState(true);
  const termRef = useRef<HTMLDivElement>(null);

  const scenario = SCENARIOS[activeTab] as Scenario;

  const resetAnimation = useCallback(() => {
    setPhase('typing-1');
    setTyped1('');
    setTyped2('');
    setFrame(0);
  }, []);

  useEffect(() => {
    resetAnimation();
  }, [activeTab, resetAnimation]);

  const handleTabClick = (idx: number) => setActiveTab(idx);

  const past = (p: Phase) => PHASES.indexOf(phase) >= PHASES.indexOf(p);

  useEffect(() => {
    const id = setInterval(() => setCursorOn(v => !v), 530);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (phase !== 'typing-1') return;
    let i = 0;
    const id = setInterval(() => {
      if (i <= scenario.cmd1.length) {
        setTyped1(scenario.cmd1.slice(0, i));
        i++;
      } else {
        clearInterval(id);
        setTimeout(() => setPhase('spin-1'), 300);
      }
    }, 40);
    return () => clearInterval(id);
  }, [phase, scenario.cmd1]);

  useEffect(() => {
    if (phase !== 'spin-1' && phase !== 'spin-2') return;
    const id = setInterval(() => setFrame(f => (f + 1) % ORA_FRAMES.length), 80);
    const dur = phase === 'spin-1' ? 2000 : 1400;
    const t = setTimeout(() => {
      clearInterval(id);
      setPhase(phase === 'spin-1' ? 'result-1' : 'result-2');
    }, dur);
    return () => {
      clearInterval(id);
      clearTimeout(t);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'result-1') return;
    const t = setTimeout(() => setPhase('typing-2'), 1500);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'typing-2') return;
    let i = 0;
    const id = setInterval(() => {
      if (i <= scenario.cmd2.length) {
        setTyped2(scenario.cmd2.slice(0, i));
        i++;
      } else {
        clearInterval(id);
        setTimeout(() => setPhase('spin-2'), 300);
      }
    }, 40);
    return () => clearInterval(id);
  }, [phase, scenario.cmd2]);

  useEffect(() => {
    if (phase !== 'result-2') return;
    const t = setTimeout(() => setPhase('done'), 800);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'done') return;
    const t = setTimeout(() => {
      setActiveTab(prev => (prev + 1) % SCENARIOS.length);
    }, 2000);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    setTimeout(() => {
      termRef.current?.scrollTo({
        top: termRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }, 30);
  }, [phase, typed1, typed2, frame]);

  const cursor = (
    <span
      className={cn(
        'inline-block w-[7px] h-[15px] ml-px align-middle bg-foreground',
        cursorOn ? 'opacity-100' : 'opacity-0'
      )}
    />
  );

  const prompt = <span className="text-foreground">~ $ </span>;

  const spin = (text: string) => (
    <div className="text-foreground">
      {ORA_FRAMES[frame]} {text}
    </div>
  );

  const done = (text: string) => <div className="text-foreground">{text}</div>;

  return (
    <div className="agents-terminal max-w-3xl w-full font-mono">
      <div className="overflow-hidden border border-border">
        {/*
          Terminal title bar. Mac traffic-light dots in muted Sendero
          tones — close, minimize, zoom — instead of flat-gray
          identical circles. Subtle distinctive detail; reads as a
          real terminal without screaming "Mac chrome."
        */}
        <div
          className="agents-terminal-titlebar select-none flex items-center h-7 px-3 border-b border-border"
          style={{ background: '#1a1410' }}
        >
          <div className="flex gap-[6px]">
            <span
              className="block w-[10px] h-[10px] rounded-full"
              style={{ background: '#e16454' }}
            />
            <span
              className="block w-[10px] h-[10px] rounded-full"
              style={{ background: '#dba94e' }}
            />
            <span
              className="block w-[10px] h-[10px] rounded-full"
              style={{ background: '#7fa97a' }}
            />
          </div>
          <span className="flex-1 text-center text-[10px] tracking-wide text-foreground -ml-10">
            sendero — zsh
          </span>
        </div>

        <div className="flex" style={{ background: '#1f1814' }}>
          {SCENARIOS.map((s, i) => (
            <button
              key={s.label}
              type="button"
              onClick={() => handleTabClick(i)}
              className={cn(
                'relative flex-1 px-4 py-1.5 text-[11px] uppercase tracking-[0.12em] transition-colors',
                i === activeTab
                  ? 'bg-[var(--ink)] text-[#fdfbf7]'
                  : 'text-[color:color-mix(in_oklab,#fdfbf7_70%,transparent)] hover:text-[#fdfbf7] hover:bg-[color:color-mix(in_oklab,#fdfbf7_8%,transparent)]',
                i > 0 && 'border-l border-l-[color:color-mix(in_oklab,#fdfbf7_15%,transparent)]'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div
          ref={termRef}
          className="agents-terminal-body overflow-auto h-[380px] md:h-[460px] scroll-smooth p-5 text-[13px] leading-[1.7] text-foreground"
          style={{
            background:
              'radial-gradient(ellipse 120% 100% at 50% 0%, #1c1612 0%, #15110d 60%, #120e0a 100%)',
          }}
        >
          <div>{prompt}npx @sendero/cli@latest</div>

          <div
            className={cn(
              'sendero-wordmark text-7xl sm:text-8xl text-foreground mt-3',
              pixelFontClass
            )}
          >
            Sendero
          </div>
          <div className="text-[color:color-mix(in_oklab,#fdfbf7_55%,transparent)] text-[10px] tracking-widest mt-1.5 mb-5">
            v0.1.0 · agent@workspace · Sendero Travel Ops
          </div>

          <div>
            {prompt}
            {typed1}
            {phase === 'typing-1' && cursor}
          </div>

          {phase === 'spin-1' && <div className="mt-1">{spin(scenario.spin1)}</div>}

          {past('result-1') && scenario.result1}

          {past('typing-2') && (
            <div className="mt-2">
              {prompt}
              {typed2}
              {phase === 'typing-2' && cursor}
            </div>
          )}

          {phase === 'spin-2' && <div className="mt-1">{spin(scenario.spin2)}</div>}

          {past('result-2') && (
            <>
              <div className="mt-1">{done(scenario.done2)}</div>
              <div className="mt-1">{scenario.result2Line}</div>
            </>
          )}

          {phase === 'done' && (
            <div className="mt-3">
              {prompt}
              {cursor}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
export function Agents({ pixelFontClass }: { pixelFontClass?: string }) {
  return (
    <div className="agents-route relative">
      <div className="max-w-screen-xl mx-auto px-4 flex flex-col lg:flex-row gap-12 justify-between items-center">
        <div className="lg:max-w-[590px] space-y-8 w-full">
          <div>
            {/*
              Editorial eyebrow — matches the home page hero's
              ink-pill treatment (.mk-eyebrow inside .mk-hero-copy
              in globals.css). Anchors the route to Sendero's brand
              system instead of a bare h1.
            */}
            <div
              className="mk-eyebrow"
              style={{
                display: 'inline-block',
                background: '#111',
                color: '#fafaf7',
                padding: '0.42em 0.72em',
                marginBottom: 24,
              }}
            >
              For AI agents
            </div>
            <h1
              className="leading-[1.05] tracking-[-0.015em]"
              style={{
                fontFamily: 'var(--display)',
                fontSize: 'clamp(40px, 5.5vw, 68px)',
                fontWeight: 450,
                color: 'var(--fg)',
                margin: 0,
                textWrap: 'balance',
              }}
            >
              Let agents run your{' '}
              <span style={{ color: 'var(--ink)', fontStyle: 'italic' }}>travel ops</span>.
            </h1>
            <p
              className="text-base leading-normal mt-6 md:mt-8"
              style={{
                color: 'color-mix(in oklab, var(--fg) 65%, transparent)',
                fontFamily: 'var(--sans)',
                maxWidth: '52ch',
              }}
            >
              One CLI. ~49 tools. Your agent searches inventory, places holds, tickets bookings,
              settles on-chain in USDC, audits every step. Anything you do in Sendero, it can do
              too.
            </p>
          </div>

          <div className="lg:max-w-[480px]">
            <CopyInstall />
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="https://app.sendero.travel"
              className="inline-flex h-11 items-center justify-center bg-primary px-6 font-mono text-sm text-primary-foreground transition-colors hover:!bg-[color:var(--ink)] hover:!text-white"
            >
              Start automating
            </Link>
            <Link
              href="https://docs.sendero.travel/claude-code-plugin"
              className="hidden md:inline-flex h-11 items-center justify-center border border-border bg-transparent px-6 font-mono text-sm text-foreground transition-colors hover:!bg-[color:var(--ink)] hover:!text-white"
            >
              Read documentation
            </Link>
          </div>
        </div>

        <Terminal pixelFontClass={pixelFontClass} />
      </div>

      <div className="space-y-16 max-w-screen-lg mx-auto px-4">
        <section aria-labelledby="agents-installer-title" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h3 id="agents-installer-title" className="font-sans text-2xl text-foreground">
              Install
            </h3>
            <p className="text-[color:color-mix(in_oklab,var(--fg)_55%,transparent)] text-sm">
              Pick your install path. Same auth gate, same tool surface — different ergonomics.
            </p>
          </div>
          <McpInstaller mcpUrl={SENDERO_MCP_URL} apiKeysHref={SENDERO_API_KEYS_URL} />
        </section>

        <SectionDivider />

        {/*
          Features + Possibilities sections removed — the install panel
          + the in-terminal scenarios already cover what those grids
          said, and the page reads tighter without the 21 cards.
        */}

        <div className="grid grid-cols-1 md:grid-cols-3 mt-4">
          <div className="border border-border p-1 -mt-[1px] -ml-[1px]">
            <div className="p-4 space-y-4">
              <h2 className="text-sm text-foreground">CLI</h2>
              <ul className="text-[color:color-mix(in_oklab,var(--fg)_55%,transparent)] space-y-2">
                <li className="text-sm">◇ Search, hold, confirm, settle, refund</li>
                <li className="text-sm">◇ Structured JSON when piped, tables on TTY</li>
                <li className="text-sm">◇ Browser-based key mint</li>
                <li className="text-sm">◇ Workspace switching</li>
                <li className="text-sm">◇ Single npx command</li>
              </ul>
            </div>
          </div>

          <div className="border border-border p-1 -mt-[1px] -ml-[1px]">
            <div className="p-4 space-y-4">
              <h2 className="text-sm text-foreground">MCP</h2>
              <ul className="text-[color:color-mix(in_oklab,var(--fg)_55%,transparent)] space-y-2">
                <li className="text-sm">◇ ~49 tools across travel-ops</li>
                <li className="text-sm">◇ HTTP transport — works with any MCP client</li>
                <li className="text-sm">◇ Claude Desktop, Claude Code, Cursor, Codex, VS Code</li>
                <li className="text-sm">◇ Same auth gate as the CLI</li>
                <li className="text-sm">◇ Sandbox keys auto-mint on workspace create</li>
              </ul>
            </div>
          </div>

          <div className="border border-border p-1 -mt-[1px] -ml-[1px]">
            <div className="p-4 space-y-4">
              <h2 className="text-sm text-foreground">Developer experience</h2>
              <ul className="text-[color:color-mix(in_oklab,var(--fg)_55%,transparent)] space-y-2">
                <li className="text-sm">◇ OpenAPI 3.1 spec at /api/openapi.json</li>
                <li className="text-sm">◇ llms.txt advertises every surface</li>
                <li className="text-sm">◇ TypeScript SDK auto-generated</li>
                <li className="text-sm">◇ One canonical tool registry</li>
                <li className="text-sm">◇ Open-source plugin + CLI</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="hidden md:flex justify-center mt-12">
          <Link
            href="https://app.sendero.travel"
            className="inline-flex h-11 items-center justify-center bg-primary px-6 font-mono text-sm text-primary-foreground transition-colors hover:!bg-[color:var(--ink)] hover:!text-white"
          >
            Start automating
          </Link>
        </div>
      </div>

      <div className="max-w-screen-lg mx-auto mt-16 mb-24 px-4">
        {/*
          Get-started CTA panel — parchment surface with the contour-
          line topography pattern bleeding through (mask-image →
          color-mix in oklab so the linework picks up the route's
          ink/vermillion mix). Same hero-pattern source the dashboard
          uses (apps/app/app/globals.css §"app-shell-root::before").
        */}
        <div
          className="agents-cta border border-border p-8 lg:p-12 text-center relative overflow-hidden"
          style={{
            background: 'var(--bg)',
          }}
        >
          {/* Topography wash */}
          <span
            aria-hidden="true"
            className="agents-cta-topography pointer-events-none absolute inset-0"
          />
          <div className="relative z-10">
            <h2 className="font-sans text-2xl sm:text-3xl text-foreground mb-4">Get started</h2>
            <p className="font-sans text-base text-[color:color-mix(in_oklab,var(--fg)_55%,transparent)] mb-6 max-w-lg mx-auto">
              One CLI. One MCP server. Every travel-ops operation your agent needs.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link
                href="https://app.sendero.travel"
                className="inline-flex h-11 items-center justify-center bg-primary px-6 font-mono text-sm text-primary-foreground transition-colors hover:!bg-[color:var(--ink)] hover:!text-white"
              >
                Start automating
              </Link>
              <Link
                href="https://docs.sendero.travel"
                className="inline-flex h-11 items-center justify-center border border-primary bg-background px-6 font-mono text-sm text-foreground transition-colors hover:!bg-[color:var(--ink)] hover:!text-white"
              >
                Read documentation
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
