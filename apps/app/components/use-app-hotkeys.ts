'use client';

/**
 * Global keyboard shortcuts for Sendero.
 *
 * Two registers, both single-source-of-truth in HOTKEY_MANIFEST:
 *
 *  • Action chord: `mod+shift+<letter>` opens a wallet dialog (deposit,
 *    send, swap, bridge). Modifier-prefixed so we never collide with
 *    text input.
 *  • "Go" chord: `g <letter>` navigates to a route, Linear-style.
 *    Pressing `g` enters a 1-second window; the next letter resolves to
 *    the route. Suppressed inside form controls.
 *
 * The manifest is the same shape exported to llms.txt so computer-use
 * agents can list shortcuts and drive the app deterministically.
 *
 * Mount once at AppChrome (top-level dashboard layout). Safe to mount
 * again — the listener is global and idempotent per hook instance.
 */

import { useEffect, useRef } from 'react';

import { useRouter } from 'next/navigation';
import { useQueryState } from 'nuqs';

const GO_TIMEOUT_MS = 1000;

export type HotkeyEntry =
  | {
      kind: 'wallet';
      combo: string; // canonical `mod+shift+d`
      label: string;
      param: 'deposit' | 'send' | 'swap' | 'bridge';
    }
  | {
      kind: 'nav';
      combo: string; // canonical `g h`
      label: string;
      href: string;
    }
  | {
      kind: 'command';
      combo: string;
      label: string;
      command: 'open-search' | 'open-arcscan' | 'toggle-sidebar';
    };

export const HOTKEY_MANIFEST: HotkeyEntry[] = [
  // Commands
  { kind: 'command', combo: 'mod+k', label: 'Open command palette', command: 'open-search' },
  { kind: 'command', combo: 'mod+b', label: 'Toggle sidebar', command: 'toggle-sidebar' },
  {
    kind: 'command',
    combo: 'g x',
    label: 'Open Arcscan for active agent',
    command: 'open-arcscan',
  },
  // Wallet actions (mod+shift+letter)
  { kind: 'wallet', combo: 'mod+shift+d', label: 'Deposit USDC', param: 'deposit' },
  { kind: 'wallet', combo: 'mod+shift+s', label: 'Send', param: 'send' },
  { kind: 'wallet', combo: 'mod+shift+w', label: 'Swap (USDC ↔ EURC)', param: 'swap' },
  { kind: 'wallet', combo: 'mod+shift+r', label: 'Bridge to Arc', param: 'bridge' },
  // Navigation (`g <letter>`)
  { kind: 'nav', combo: 'g h', label: 'Home', href: '/dashboard' },
  { kind: 'nav', combo: 'g c', label: 'Agent console', href: '/dashboard/console' },
  { kind: 'nav', combo: 'g i', label: 'Trip inbox', href: '/dashboard/inbox' },
  { kind: 'nav', combo: 'g t', label: 'Trips', href: '/dashboard/trips' },
  { kind: 'nav', combo: 'g r', label: 'Active trips map', href: '/dashboard/trips/map' },
  { kind: 'nav', combo: 'g v', label: 'Invoices', href: '/dashboard/billing/invoices' },
  // Plans live inside Clerk's OrganizationProfile modal (opened from the
  // PlanTeaser on /dashboard). No standalone route — the hotkey lands on
  // the dashboard so the user can click Manage plan from there.
  { kind: 'nav', combo: 'g p', label: 'Plans & pricing', href: '/dashboard' },
  { kind: 'nav', combo: 'g n', label: 'Spend', href: '/dashboard/spend' },
  { kind: 'nav', combo: 'g a', label: 'Caps', href: '/dashboard/caps' },
  { kind: 'nav', combo: 'g w', label: 'WhatsApp channel', href: '/dashboard/channels/whatsapp' },
  { kind: 'nav', combo: 'g k', label: 'Slack channel', href: '/dashboard/channels/slack' },
  { kind: 'nav', combo: 'g m', label: 'MCP integration', href: '/dashboard/integrations/mcp' },
  { kind: 'nav', combo: 'g s', label: 'Settings', href: '/dashboard/settings' },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  // cmdk command palette input
  if (target.getAttribute('cmdk-input') === '') return true;
  return false;
}

function modPressed(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

export function useAppHotkeys() {
  const router = useRouter();
  const [, setSwap] = useQueryState('swap');
  const [, setSend] = useQueryState('send');
  const [, setDeposit] = useQueryState('deposit');
  const [, setBridge] = useQueryState('bridge');

  // Latest router/setter refs so the global listener stays mounted once.
  const refs = useRef({ router, setSwap, setSend, setDeposit, setBridge });
  refs.current = { router, setSwap, setSend, setDeposit, setBridge };

  useEffect(() => {
    let goPending = false;
    let goTimer: ReturnType<typeof setTimeout> | null = null;

    const clearGo = () => {
      goPending = false;
      if (goTimer) {
        clearTimeout(goTimer);
        goTimer = null;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Wallet shortcuts (mod+shift+letter) — fire even from focused
      // controls, because the modifier signals an explicit command.
      if (modPressed(e) && e.shiftKey) {
        const k = e.key.toLowerCase();
        const wallet = HOTKEY_MANIFEST.find(h => h.kind === 'wallet' && h.combo.endsWith(`+${k}`));
        if (wallet && wallet.kind === 'wallet') {
          e.preventDefault();
          if (wallet.param === 'deposit') refs.current.setDeposit('open');
          if (wallet.param === 'send') refs.current.setSend('open');
          if (wallet.param === 'swap') refs.current.setSwap('open');
          if (wallet.param === 'bridge') refs.current.setBridge('open');
          return;
        }
      }

      // Everything below is suppressed while typing.
      if (isTypingTarget(e.target)) {
        clearGo();
        return;
      }

      // Don't engage chord mode if any modifier is held (Cmd+S, etc).
      if (e.altKey || e.metaKey || e.ctrlKey) {
        clearGo();
        return;
      }

      const k = e.key.toLowerCase();

      if (goPending) {
        const nav = HOTKEY_MANIFEST.find(h => h.kind === 'nav' && h.combo === `g ${k}`);
        clearGo();
        if (nav && nav.kind === 'nav') {
          e.preventDefault();
          refs.current.router.push(nav.href);
          return;
        }
        // 'g x' command — open Arcscan for active agent (delegated to a
        // CustomEvent listener so the hook stays free of agent state).
        if (k === 'x') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('sendero:hotkey', { detail: 'open-arcscan' }));
          return;
        }
        return;
      }

      if (k === 'g') {
        e.preventDefault();
        goPending = true;
        goTimer = setTimeout(clearGo, GO_TIMEOUT_MS);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearGo();
    };
  }, []);
}

/**
 * Render the canonical combo with the platform key. `mod` → ⌘ on Mac,
 * `Ctrl` elsewhere. Pure formatter — used in tooltips and llms.txt.
 */
export function formatHotkey(combo: string, isMac: boolean): string {
  return combo
    .split(' ')
    .map(part =>
      part
        .split('+')
        .map(token => {
          if (token === 'mod') return isMac ? '⌘' : 'Ctrl';
          if (token === 'shift') return isMac ? '⇧' : 'Shift';
          if (token === 'alt') return isMac ? '⌥' : 'Alt';
          return token.length === 1 ? token.toUpperCase() : token;
        })
        .join(isMac ? '' : '+')
    )
    .join(' ');
}
