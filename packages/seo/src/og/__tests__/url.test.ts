/**
 * Smoke tests for the OG URL helpers.
 *
 * Light coverage — `buildOgImageUrl` round-trips through
 * `parseOgQueryParams` so consumer apps can trust both ends of the
 * query-string contract. Bullets and CTA flow through; missing
 * params fall back to safe defaults instead of throwing.
 */

import { describe, expect, it } from 'bun:test';

import { buildOgImageUrl, parseOgQueryParams } from '../url';

const ORIGIN = 'https://sendero.travel';

describe('buildOgImageUrl', () => {
  it('emits an absolute URL with the title param', () => {
    const url = buildOgImageUrl(ORIGIN, { title: 'Pricing' });
    expect(url).toStartWith('https://sendero.travel/api/og?');
    expect(new URL(url).searchParams.get('title')).toBe('Pricing');
  });

  it('omits empty params so the URL stays clean', () => {
    const url = buildOgImageUrl(ORIGIN, { title: 'Hi' });
    const params = new URL(url).searchParams;
    expect(params.has('description')).toBe(false);
    expect(params.has('eyebrow')).toBe(false);
    expect(params.getAll('bullet')).toEqual([]);
  });

  it('serializes multiple bullets via repeated params', () => {
    const url = buildOgImageUrl(ORIGIN, {
      title: 'Pricing',
      bullets: ['One', 'Two', 'Three'],
    });
    expect(new URL(url).searchParams.getAll('bullet')).toEqual(['One', 'Two', 'Three']);
  });
});

describe('parseOgQueryParams', () => {
  it('round-trips through buildOgImageUrl', () => {
    const url = buildOgImageUrl(ORIGIN, {
      title: 'MCP integration',
      description: 'Connect any MCP client.',
      eyebrow: 'docs.sendero.travel',
      bullets: ['Claude', 'Cursor'],
      cta: 'See docs',
      site: 'docs.sendero.travel',
    });
    const params = parseOgQueryParams(new URL(url).searchParams);
    expect(params.title).toBe('MCP integration');
    expect(params.description).toBe('Connect any MCP client.');
    expect(params.eyebrow).toBe('docs.sendero.travel');
    expect(params.bullets).toEqual(['Claude', 'Cursor']);
    expect(params.ctaLabel).toBe('See docs');
    expect(params.site).toBe('docs.sendero.travel');
  });

  it('falls back to a default title when none is given', () => {
    const params = parseOgQueryParams(new URLSearchParams());
    expect(params.title).toBe('Sendero');
    expect(params.description).toBeUndefined();
    expect(params.bullets).toEqual([]);
  });

  it('drops blank bullets so route handlers receive a clean array', () => {
    const url = `${ORIGIN}/api/og?title=Hi&bullet=&bullet=Real&bullet=%20`;
    const params = parseOgQueryParams(new URL(url).searchParams);
    expect(params.bullets).toEqual(['Real']);
  });
});
