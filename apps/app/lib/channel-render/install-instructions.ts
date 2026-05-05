/**
 * Per-device eSIM install instructions — single source of truth shared
 * across the four channel renderers (operator / slack / whatsapp / web)
 * AND the universal `/install/esim/[token]` install page.
 *
 * Edit copy here — every surface picks up the change. Bullets are short
 * because some channels (WhatsApp) hard-cap message length and others
 * (Slack mrkdwn) render ugly when text wraps three times in a section.
 *
 * `oneTap === true` flags the surfaces where iOS Universal Link
 * activation works (iOS 17.4+ on Safari with the LPA: deep-link). The
 * install page uses this signal to auto-redirect; non-iOS clients fall
 * back to the QR scan flow.
 */

export type DeviceKind = 'ios' | 'androidPixel' | 'androidSamsung' | 'other';

export interface DeviceInstructions {
  /** Display label for tab strips, list rows, etc. */
  label: string;
  /** Short blurb under the label — one line. */
  subLabel?: string;
  /** True when the LPA: deep-link auto-installs (iOS 17.4+ Safari). */
  oneTap: boolean;
  /** Numbered steps. Each is one short sentence. */
  steps: string[];
  /** Whether to surface the raw activation code as a copyable fallback. */
  showLpaCode?: boolean;
}

export const INSTALL_INSTRUCTIONS: Record<DeviceKind, DeviceInstructions> = {
  ios: {
    label: 'iPhone',
    subLabel: 'iOS 17.4 or newer',
    oneTap: true,
    steps: [
      'Tap "Install on iPhone" on the iPhone you\'ll travel with — not another device.',
      'iOS opens Cellular settings — tap "Add eSIM".',
      'Label the line "Trip eSIM" and confirm.',
      'Toggle "Trip eSIM" on for data when you land.',
    ],
  },
  androidPixel: {
    label: 'Pixel',
    subLabel: 'Android 13 or newer',
    oneTap: false,
    steps: [
      'Settings → Network & Internet → SIMs.',
      'Tap "Download a SIM instead".',
      'Scan the QR with your laptop or another phone showing this screen.',
      'Confirm "Trip eSIM" and toggle it on.',
    ],
  },
  androidSamsung: {
    label: 'Samsung',
    subLabel: 'One UI 5 or newer',
    oneTap: false,
    steps: [
      'Settings → Connections → SIM manager.',
      'Tap "Add eSIM" → "Scan QR code".',
      'Scan from another device showing this screen.',
      'Label "Trip eSIM" and toggle on.',
    ],
  },
  other: {
    label: 'Other / manual',
    oneTap: false,
    steps: [
      'Open eSIM settings on your device.',
      'Choose "Scan QR code".',
      'Scan the QR shown on this screen.',
      'If QR fails, paste the activation code manually.',
    ],
    showLpaCode: true,
  },
};

export const DEVICE_ORDER: DeviceKind[] = ['ios', 'androidPixel', 'androidSamsung', 'other'];

/**
 * Detect device family from a User-Agent string. Used by the install
 * page to auto-redirect on iOS and choose the default tab elsewhere.
 * Conservative: anything we can't classify falls through to `'other'`.
 */
export function detectDeviceFromUA(userAgent: string | null | undefined): DeviceKind {
  if (!userAgent) return 'other';
  const ua = userAgent.toLowerCase();
  // iOS — including iPad Safari which now reports "macOS" on iPadOS 13+.
  if (/iphone|ipod|ipad/.test(ua)) return 'ios';
  if (/macintosh/.test(ua) && /mobile/.test(ua)) return 'ios';
  if (/pixel/.test(ua)) return 'androidPixel';
  if (/samsungbrowser|sm-|gt-|galaxy/.test(ua)) return 'androidSamsung';
  if (/android/.test(ua)) return 'androidPixel'; // Pixel steps are the closest fit for stock Android.
  return 'other';
}
