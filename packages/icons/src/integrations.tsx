/**
 * Integration brand marks rendered into `/dashboard/integrations` cards.
 * MCP ships as an inline SVG component so `currentColor` inherits from
 * the parent's CSS color (img tags don't propagate CSS color into
 * externally-loaded SVG documents). Bufi ships as a webp asset.
 */

import Image from 'next/image';
import type { CSSProperties, SVGProps } from 'react';

import bufiSrc from '../assets/integrations/bufi.png';

export const BufiLogoSrc = bufiSrc;

export function BufiLogo({
  size = 192,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Image
      src={bufiSrc}
      alt=""
      width={size}
      height={size}
      aria-hidden
      className={className ?? `size-[${size}px] shrink-0`}
      style={style}
    />
  );
}

/**
 * Claude Code plugin mark — abstract `{·}` motif: bracket pair around
 * a center dot. Reads as "code wrapping a runtime entry-point" without
 * borrowing Anthropic-owned brand marks. Inlined so `currentColor`
 * picks up the parent CSS color (matches the pattern used by McpMark).
 */
export function ClaudeCodePluginMark(props: SVGProps<SVGSVGElement> & { size?: number }) {
  const { size = 192, ...rest } = props;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      <title>Claude Code plugin</title>
      {/* Left bracket — opens scope */}
      <path d="M9 4 C7 4 6 5 6 7 V10 C6 11 5 12 4 12 C5 12 6 13 6 14 V17 C6 19 7 20 9 20" />
      {/* Right bracket — closes scope */}
      <path d="M15 4 C17 4 18 5 18 7 V10 C18 11 19 12 20 12 C19 12 18 13 18 14 V17 C18 19 17 20 15 20" />
      {/* Center dot — the plugin runtime */}
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

/**
 * Official ModelContextProtocol mark, inlined so `currentColor` works.
 * Source: https://github.com/modelcontextprotocol — paths verbatim.
 */
export function McpMark(props: SVGProps<SVGSVGElement> & { size?: number }) {
  const { size = 192, ...rest } = props;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden
      {...rest}
    >
      <title>ModelContextProtocol</title>
      <path d="M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z" />
      <path d="M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z" />
    </svg>
  );
}
