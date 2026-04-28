/**
 * AI provider brand marks (Google, Anthropic, OpenAI). Used by the
 * console + agent-chat model picker. Webp at native resolution; consumer
 * passes a render `size` to `<ProviderIcon>` and gets a sized next/image.
 */

import Image from 'next/image';
import type { CSSProperties } from 'react';

import anthropicSrc from '../assets/providers/anthropic.webp';
import googleSrc from '../assets/providers/google.webp';
import openaiSrc from '../assets/providers/openai.webp';

export type ProviderSlug = 'google' | 'anthropic' | 'openai';

export const PROVIDER_ICON_SOURCES: Record<ProviderSlug, typeof googleSrc> = {
  google: googleSrc,
  anthropic: anthropicSrc,
  openai: openaiSrc,
};

export const PROVIDER_LABEL: Record<ProviderSlug, string> = {
  google: 'Google',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

export function ProviderIcon({
  slug,
  size = 14,
  className,
  style,
}: {
  slug: ProviderSlug;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Image
      src={PROVIDER_ICON_SOURCES[slug]}
      alt=""
      width={size}
      height={size}
      aria-hidden
      className={className ?? 'shrink-0'}
      style={style}
      unoptimized
    />
  );
}
