'use client';

/**
 * Sendero /agents marketing page — modeled after Midday's /agents
 * route but rebranded to Sendero's identity (parchment + vermillion +
 * ink, not the Midday blue). Section structure, terminal demo, and
 * grid layouts are inspired by Midday; copy + scenarios are 100%
 * Sendero (travel-ops, USDC settlement, MCP-native).
 *
 * The page boots a self-driving terminal demo that cycles through
 * four representative agent flows: search → hold → confirm → audit.
 * Tabs also allow click-to-jump for visitors who want to inspect a
 * specific scenario.
 */

import { McpInstaller } from '@sendero/ui/mcp-installer';
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

const SENDERO_MCP_URL = 'https://app.sendero.travel/api/mcp';
const SENDERO_API_KEYS_URL = 'https://app.sendero.travel/dashboard/settings/api-keys';

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
      <div className="relative mt-3 border-[0.5px] border-[var(--ink)] text-[12px]">
        <span className="absolute -top-[10px] left-3 bg-[var(--surface)] px-1.5 text-[11px] tracking-wide">
          BUE → MIA · 12 May 2026 · 3 offers
        </span>
        <table className="w-full mt-2 mb-1">
          <thead>
            <tr className="text-left border-b-[0.5px] border-[var(--ink)]">
              <th className="font-normal pl-3 pr-2 pb-1">CARRIER</th>
              <th className="font-normal pr-2 pb-1">DEPART</th>
              <th className="font-normal pr-2 pb-1">CABIN</th>
              <th className="font-normal pr-3 pb-1 text-right">FARE</th>
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
      </div>
    ),
    result2Line: '  Held offer off_8f2 for 24h · expires 2026-04-29 18:20 UTC',
  },
  {
    label: 'Confirm & settle',
    cmd1: 'sendero tools call confirm_booking \'{"holdId":"hold_a1b","payerWallet":"treasury"}\'',
    cmd2: 'sendero tools call settle_invoice \'{"bookingId":"bk_5c1"}\'',
    spin1: 'Ticketing offer + writing on-chain audit row...',
    spin2: 'Settling commission to take-rate wallet...',
    done2: 'Settlement landed in block 412,839,221.',
    result1: (
      <div className="mt-2 text-[12px] space-y-0.5">
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
    done2: 'Matching complete.',
    result1: (
      <div className="relative mt-3 border-[0.5px] border-[var(--ink)] text-[12px]">
        <span className="absolute -top-[10px] left-3 bg-[var(--surface)] px-1.5 text-[11px] tracking-wide">
          Unmatched settlements [3]
        </span>
        <table className="w-full mt-2 mb-1">
          <thead>
            <tr className="text-left border-b-[0.5px] border-[var(--ink)]">
              <th className="font-normal pl-3 pr-2 pb-1">SETTLEMENT</th>
              <th className="font-normal pr-2 pb-1">AMOUNT</th>
              <th className="font-normal pr-2 pb-1">CHAIN</th>
              <th className="font-normal pr-3 pb-1">SUGGEST</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="pl-3 pr-2 py-[3px]">stl_91a</td>
              <td className="pr-2 py-[3px]">$842.00</td>
              <td className="pr-2 py-[3px]">arc</td>
              <td className="pr-3 py-[3px]">bk_5c1</td>
            </tr>
            <tr>
              <td className="pl-3 pr-2 py-[3px]">stl_8e7</td>
              <td className="pr-2 py-[3px]">$617.00</td>
              <td className="pr-2 py-[3px]">arc</td>
              <td className="pr-3 py-[3px]">bk_5b9</td>
            </tr>
            <tr>
              <td className="pl-3 pr-2 py-[3px]">stl_8d2</td>
              <td className="pr-2 py-[3px]">$305.50</td>
              <td className="pr-2 py-[3px]">base</td>
              <td className="pr-3 py-[3px]">bk_5a4</td>
            </tr>
          </tbody>
        </table>
      </div>
    ),
    result2Line: '  3/3 settlements paired with bookings · ledger reconciled.',
  },
  {
    label: 'Audit & export',
    cmd1: 'sendero tools call export_trip_summary \'{"tripId":"tr_4d9","format":"pdf"}\'',
    cmd2: 'sendero tools call export_audit_log \'{"period":"2026-Q2","format":"csv"}\'',
    spin1: 'Rendering trip summary PDF...',
    spin2: 'Streaming audit log to CSV...',
    done2: 'Export complete.',
    result1: (
      <div className="mt-2 text-[12px] space-y-0.5">
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

function CopyInstall({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    if (typeof window === 'undefined') return;
    navigator.clipboard.writeText(command).catch(() => {
      // Best-effort — older browsers / sandboxed iframes drop clipboard
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1100);
  }, [command]);

  return (
    <button
      type="button"
      onClick={copy}
      className="relative flex w-full cursor-pointer items-center border border-[color-mix(in_oklab,var(--ink)_22%,transparent)] bg-[var(--surface,#fdfbf7)] p-2 px-4 text-sm transition-colors hover:bg-[color-mix(in_oklab,var(--vermillion)_8%,white)]"
      style={{
        backgroundImage:
          'repeating-linear-gradient(-60deg, color-mix(in oklab, var(--ink) 12%, transparent), color-mix(in oklab, var(--ink) 12%, transparent) 1px, transparent 1px, transparent 6px)',
      }}
    >
      <span className="truncate font-mono text-[var(--ink)]">$ {command}</span>
      <span className="ml-auto flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-[color-mix(in_oklab,var(--ink)_55%,transparent)]">
        {label ?? 'Copy'}
      </span>
      {copied ? (
        <span className="absolute -top-7 left-1/2 -translate-x-1/2 rounded bg-[var(--ink)] px-2 py-0.5 font-mono text-[11px] text-[var(--parchment,#fdfbf7)]">
          Copied
        </span>
      ) : null}
    </button>
  );
}

function Terminal() {
  const [activeTab, setActiveTab] = useState(0);
  const [phase, setPhase] = useState<Phase>('typing-1');
  const [typed1, setTyped1] = useState('');
  const [typed2, setTyped2] = useState('');
  const [frame, setFrame] = useState(0);
  const [cursorOn, setCursorOn] = useState(true);
  const termRef = useRef<HTMLDivElement>(null);

  const scenario = SCENARIOS[activeTab] as Scenario;

  const reset = useCallback(() => {
    setPhase('typing-1');
    setTyped1('');
    setTyped2('');
    setFrame(0);
  }, []);

  useEffect(() => {
    reset();
  }, [activeTab, reset]);

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
    }, 20);
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
    }, 20);
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
    }, 2400);
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
      className={`inline-block w-[7px] h-[15px] ml-px align-middle bg-[var(--ink)] ${cursorOn ? 'opacity-100' : 'opacity-0'}`}
    />
  );
  const prompt = <span className="text-[var(--ink)]">~ $ </span>;
  const spin = (text: string) => (
    <div>
      {ORA_FRAMES[frame]} {text}
    </div>
  );
  const done = (text: string) => <div>{text}</div>;

  return (
    <div className="w-full max-w-3xl font-mono text-[var(--ink)]">
      <div className="overflow-hidden border border-[color-mix(in_oklab,var(--ink)_22%,transparent)]">
        <div className="flex h-7 select-none items-center border-b border-[color-mix(in_oklab,var(--ink)_22%,transparent)] bg-[color-mix(in_oklab,var(--vermillion)_10%,white)] px-3">
          <div className="flex gap-[5px]">
            <span className="block h-2 w-2 rounded-full bg-[color-mix(in_oklab,var(--ink)_25%,transparent)]" />
            <span className="block h-2 w-2 rounded-full bg-[color-mix(in_oklab,var(--ink)_25%,transparent)]" />
            <span className="block h-2 w-2 rounded-full bg-[color-mix(in_oklab,var(--ink)_25%,transparent)]" />
          </div>
          <span className="-ml-10 flex-1 text-center text-[10px] tracking-wide text-[var(--ink)]">
            sendero — zsh
          </span>
        </div>

        <div className="flex bg-[color-mix(in_oklab,var(--ink)_4%,white)]">
          {SCENARIOS.map((s, i) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setActiveTab(i)}
              className={`flex-1 border-b px-4 py-1.5 text-[11px] uppercase tracking-wide transition-colors ${
                i === activeTab
                  ? 'border-b-transparent bg-[var(--surface,#fdfbf7)] text-[var(--ink)]'
                  : 'border-b-[color-mix(in_oklab,var(--ink)_22%,transparent)] text-[color-mix(in_oklab,var(--ink)_55%,transparent)] hover:text-[var(--ink)]'
              } ${i > 0 ? 'border-l border-l-[color-mix(in_oklab,var(--ink)_22%,transparent)]' : ''}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div
          ref={termRef}
          className="h-[400px] overflow-y-auto bg-[var(--surface,#fdfbf7)] p-5 text-[13px] leading-[1.7] md:h-[460px]"
        >
          <div>{prompt}npx @sendero/cli@latest</div>
          <div className="mt-3 text-4xl tracking-tight text-[var(--ink)] sm:text-5xl">sendero</div>
          <div className="mt-1.5 mb-5 text-[10px] uppercase tracking-widest text-[color-mix(in_oklab,var(--ink)_55%,transparent)]">
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

const FEATURES = [
  {
    title: 'Search any inventory',
    description:
      'Agents call search_flights, search_stays, and search_ground against Duffel and direct supplier rates. One canonical schema across carriers and chains.',
  },
  {
    title: 'Hold without committing',
    description:
      'Place a 24h hold on any offer while finance approves, the traveler reconfirms, or policy gates resolve. Release on a timer if not confirmed.',
  },
  {
    title: 'Settle on-chain in USDC',
    description:
      'confirm_booking writes the ticket and the on-chain audit row in the same call. Arcscan URL surfaces in the response for finance.',
  },
  {
    title: 'Reconcile autonomously',
    description:
      "Settlements without paired bookings get auto-matched on holdId + amount. Anomalies surface on a queue, not in someone's inbox.",
  },
  {
    title: 'Pull reports on demand',
    description:
      'export_trip_summary, export_audit_log, export_route_map. Structured outputs for travelers, finance, and auditors — same agent surface.',
  },
  {
    title: 'Respect plan caps',
    description:
      'Every workspace has a monthly spend ceiling. Agents read cap_status and refuse to settle past it; they propose tier upgrades instead.',
  },
  {
    title: 'Sandbox by default',
    description:
      'Sandbox API keys mint automatically on workspace creation. Practice the whole flow without moving real USDC; flip a flag to go live.',
  },
  {
    title: 'Locale aware',
    description:
      'Reply in the same language the user wrote in — Spanish, Portuguese, English. The tool surface is locale-agnostic; the skill teaches Claude to mirror.',
  },
  {
    title: 'Cross-channel by design',
    description:
      'Same agent runs in WhatsApp, Slack, MCP, the web console, and email. One Trip.events ledger; every channel reads and writes to it.',
  },
  {
    title: 'Identity on ERC-8004',
    description:
      'register_agent and register_identity tools mint on-chain identity for downstream auditors. Pair every settlement with a verifiable agent ID.',
  },
  {
    title: 'Works with any MCP client',
    description:
      'Claude Code, Claude Desktop, Cursor, Codex, VS Code, Raycast, or your own agent. Same ~49 tools, same auth gate, any MCP transport.',
  },
  {
    title: 'Zero setup',
    description:
      'One npx command. Browser-based key mint. No API keys to manage, no config files. Your agent is operational in seconds.',
  },
];

const POSSIBILITIES = [
  {
    agent: 'Claude',
    title: 'Plan a trip in three turns',
    description:
      'Ask Claude to find a refundable flight, hold the best option, and ticket it once finance approves — all without leaving the chat.',
  },
  {
    agent: 'Cursor',
    title: 'Bill while you build',
    description:
      'Cursor logs your time, drafts the invoice, and sends it via Sendero. Agencies bill clients without context-switching.',
  },
  {
    agent: 'Slack',
    title: 'Approve from #travel',
    description:
      'Approval card lands in your channel. Click ✓; the bot tickets the offer, surfaces the Arcscan audit URL, and stamps Trip.events.',
  },
  {
    agent: 'WhatsApp',
    title: 'Travelers on the road',
    description:
      'Traveler texts "I missed my flight." Agent finds the next available, holds it, pings the operator on Slack for the override.',
  },
  {
    agent: 'Your agent',
    title: 'Build a custom workflow',
    description:
      'REST + MCP + OpenAPI 3.1 + llms.txt. Pull offers, settle on-chain, push receipts to your ERP. Your logic, your rules.',
  },
  {
    agent: 'Any MCP client',
    title: 'One protocol, every client',
    description:
      'Cursor, Claude Code, Codex, VS Code, Raycast — install once, ~49 tools instantly. No custom integration code.',
  },
  {
    agent: 'Manus',
    title: 'Reconcile while you sleep',
    description:
      'Manus matches settlements to bookings overnight, flags anomalies, runs the export. Ready for review when you wake up.',
  },
  {
    agent: 'Cron',
    title: 'A 20-line script',
    description:
      'Nightly: fetch unmatched settlements, match by holdId, push exceptions to Linear. The CLI is structured-output by default.',
  },
  {
    agent: 'OpenClaw',
    title: 'A 24/7 ops desk',
    description:
      'OpenClaw watches WhatsApp + Slack + email, escalates by policy, ticketing only after multi-step confirmation. The audit trail is on-chain.',
  },
];

function SectionDivider() {
  return (
    <div className="w-full py-1">
      <div
        className="h-4 w-full border-y border-[color-mix(in_oklab,var(--ink)_18%,transparent)]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(-60deg, color-mix(in oklab, var(--ink) 12%, transparent), color-mix(in oklab, var(--ink) 12%, transparent) 1px, transparent 1px, transparent 6px)',
        }}
      />
    </div>
  );
}

export function Agents() {
  return (
    <div className="relative mt-16 font-mono text-[var(--ink)]">
      <div className="mx-auto flex max-w-screen-xl flex-col items-center justify-between gap-12 px-4 pt-16 pb-12 md:py-28 lg:flex-row">
        <div className="w-full space-y-8 lg:max-w-[590px]">
          <div>
            <h1 className="font-sans text-3xl leading-[1.1] tracking-tight md:text-4xl lg:text-5xl">
              Let agents run your travel ops.
            </h1>
            <p className="mt-4 text-base leading-normal text-[color-mix(in_oklab,var(--ink)_70%,transparent)] md:mt-8">
              One CLI. ~49 tools. Your agent searches inventory, places holds, tickets bookings,
              settles on-chain in USDC, and audits every step. Anything you can do in Sendero, it
              can do too.
            </p>
          </div>

          <div className="lg:max-w-[480px]">
            <CopyInstall command="npx @sendero/cli@latest" label="Copy" />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <a
              href="https://app.sendero.travel"
              className="inline-flex h-11 items-center justify-center bg-[var(--ink)] px-6 font-mono text-sm text-[var(--parchment,#fdfbf7)] transition-colors hover:bg-[var(--vermillion)]"
            >
              Start automating
            </a>
            <a
              href="https://sendero.travel/docs/claude-code-plugin"
              className="hidden h-11 items-center justify-center border border-[var(--ink)] bg-transparent px-6 font-mono text-sm text-[var(--ink)] transition-colors hover:bg-[color-mix(in_oklab,var(--vermillion)_8%,white)] md:inline-flex"
            >
              Read documentation
            </a>
          </div>
        </div>

        <Terminal />
      </div>

      <div className="mx-auto max-w-screen-lg space-y-16 px-4">
        <section
          aria-labelledby="agents-installer-title"
          className="mt-4 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <h3 id="agents-installer-title" className="font-sans text-2xl">
              Install
            </h3>
            <p className="text-sm text-[color-mix(in_oklab,var(--ink)_65%,transparent)]">
              Pick your install path. Same auth gate, same tool surface — different ergonomics.
            </p>
          </div>
          <McpInstaller mcpUrl={SENDERO_MCP_URL} apiKeysHref={SENDERO_API_KEYS_URL} />
        </section>

        <div className="mt-12">
          <h3 className="font-sans text-2xl">Features</h3>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(feature => (
              <div
                key={feature.title}
                className="-mt-[1px] -ml-[1px] border border-[color-mix(in_oklab,var(--ink)_18%,transparent)] p-1"
              >
                <div className="space-y-3 p-4">
                  <h4 className="text-sm font-semibold">{feature.title}</h4>
                  <p className="text-sm text-[color-mix(in_oklab,var(--ink)_65%,transparent)]">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <SectionDivider />

        <div>
          <h3 className="font-sans text-2xl">Possibilities</h3>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {POSSIBILITIES.map(item => (
              <div
                key={item.title}
                className="-mt-[1px] -ml-[1px] border border-[color-mix(in_oklab,var(--ink)_18%,transparent)] p-1"
              >
                <div className="space-y-3 p-4">
                  <span className="text-xs uppercase tracking-widest text-[var(--vermillion)]">
                    {item.agent}
                  </span>
                  <h4 className="text-sm font-semibold">{item.title}</h4>
                  <p className="text-sm text-[color-mix(in_oklab,var(--ink)_65%,transparent)]">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <SectionDivider />

        <div className="grid grid-cols-1 md:grid-cols-3">
          <div className="-mt-[1px] -ml-[1px] border border-[color-mix(in_oklab,var(--ink)_18%,transparent)] p-1">
            <div className="space-y-4 p-4">
              <h4 className="text-sm font-semibold">CLI</h4>
              <ul className="space-y-2 text-[color-mix(in_oklab,var(--ink)_65%,transparent)]">
                <li className="text-sm">◇ Search, hold, confirm, settle, refund</li>
                <li className="text-sm">◇ Structured JSON when piped, tables on TTY</li>
                <li className="text-sm">◇ Browser-based key mint</li>
                <li className="text-sm">◇ Workspace switching</li>
                <li className="text-sm">◇ Single npx command</li>
              </ul>
            </div>
          </div>

          <div className="-mt-[1px] -ml-[1px] border border-[color-mix(in_oklab,var(--ink)_18%,transparent)] p-1">
            <div className="space-y-4 p-4">
              <h4 className="text-sm font-semibold">MCP</h4>
              <ul className="space-y-2 text-[color-mix(in_oklab,var(--ink)_65%,transparent)]">
                <li className="text-sm">◇ ~49 tools across the travel-ops surface</li>
                <li className="text-sm">◇ HTTP transport — works with any MCP client</li>
                <li className="text-sm">◇ Claude Desktop, Claude Code, Cursor, Codex, VS Code</li>
                <li className="text-sm">◇ Same auth gate as the CLI</li>
                <li className="text-sm">◇ Sandbox keys auto-mint on workspace create</li>
              </ul>
            </div>
          </div>

          <div className="-mt-[1px] -ml-[1px] border border-[color-mix(in_oklab,var(--ink)_18%,transparent)] p-1">
            <div className="space-y-4 p-4">
              <h4 className="text-sm font-semibold">Developer experience</h4>
              <ul className="space-y-2 text-[color-mix(in_oklab,var(--ink)_65%,transparent)]">
                <li className="text-sm">◇ OpenAPI 3.1 spec at /api/openapi.json</li>
                <li className="text-sm">◇ llms.txt advertises every surface</li>
                <li className="text-sm">◇ TypeScript SDK auto-generated</li>
                <li className="text-sm">◇ One canonical tool registry</li>
                <li className="text-sm">◇ Open-source plugin + CLI</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 hidden justify-center md:flex">
          <a
            href="https://app.sendero.travel"
            className="inline-flex h-11 items-center justify-center bg-[var(--ink)] px-6 font-mono text-sm text-[var(--parchment,#fdfbf7)] transition-colors hover:bg-[var(--vermillion)]"
          >
            Start automating
          </a>
        </div>

        <SectionDivider />

        <div className="text-center">
          <h2 className="font-sans text-2xl sm:text-3xl">Infrastructure</h2>
          <p className="mx-auto mt-4 max-w-md text-base leading-normal text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">
            Sendero is the backbone. Agents connect via MCP, CLI, or REST. Every operation syncs
            back to the workspace ledger and on-chain audit trail.
          </p>
          <pre
            className="mx-auto mt-4 inline-block p-4 text-left text-[11px] leading-5"
            style={{ fontFamily: 'monospace', whiteSpace: 'pre' }}
          >
            {`                                            ┌──────────────────┐
                                            │      Agents      │
                                            └────────┬─────────┘
                                                     │
                                              MCP / CLI / API
                                                     │
   ┌─────────────────────────────────────────────────┴─────────────────────────────────────────────────┐
   │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  Sendero  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
   │░░░░░░░░░░░░░░░░░░░░  Travel-ops backbone with on-chain settlement  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
   └─────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬─────────────────────────┘
         │          │          │          │          │          │          │
         ▼          ▼          ▼          ▼          ▼          ▼          ▼
    ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
    │ Search │ │  Hold  │ │ Ticket │ │ Settle │ │  Audit │ │ Wallet │ │ Export │
    └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘`}
          </pre>
        </div>
      </div>

      <div className="mx-auto mt-16 mb-24 max-w-screen-lg px-4">
        <div className="relative border border-[color-mix(in_oklab,var(--ink)_22%,transparent)] bg-[var(--surface,#fdfbf7)] p-8 text-center lg:p-12">
          <h2 className="mb-4 font-sans text-2xl sm:text-3xl">Get started</h2>
          <p className="mx-auto mb-6 max-w-lg font-sans text-base text-[color-mix(in_oklab,var(--ink)_70%,transparent)]">
            One CLI. One MCP server. Every travel-ops operation your agent needs.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a
              href="https://app.sendero.travel"
              className="inline-flex h-11 items-center justify-center bg-[var(--ink)] px-6 font-mono text-sm text-[var(--parchment,#fdfbf7)] transition-colors hover:bg-[var(--vermillion)]"
            >
              Start automating
            </a>
            <a
              href="https://sendero.travel/docs"
              className="inline-flex h-11 items-center justify-center border border-[var(--ink)] bg-transparent px-6 font-mono text-sm text-[var(--ink)] transition-colors hover:bg-[color-mix(in_oklab,var(--vermillion)_8%,white)]"
            >
              Read documentation
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
