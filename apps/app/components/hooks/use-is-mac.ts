'use client';

import { useEffect, useState } from 'react';

/**
 * Returns true when the client is on macOS / iOS. Used to decide between
 * ⌘K (Mac) and Ctrl+K (everywhere else) shortcut hints. Renders false on
 * the server so hydration stays stable; the real value lands after mount.
 */
export function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const ua = navigator.userAgent ?? '';
    // Modern: navigator.userAgentData.platform; fallback to UA sniff.
    // Mac Safari, Chrome on Mac, iPadOS (reports MacIntel), iOS Safari.
    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
        ?.platform ??
      navigator.platform ??
      '';
    setIsMac(/Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X/i.test(ua));
  }, []);

  return isMac;
}

/** Formatted shortcut hint: "⌘K" on Mac, "Ctrl+K" elsewhere. */
export function useCmdKeyLabel(key: string = 'K'): string {
  const isMac = useIsMac();
  return isMac ? `⌘${key}` : `Ctrl+${key}`;
}
