import { describe, expect, test } from 'bun:test';
import {
  absoluteUrl,
  buildLlmsTxt,
  buildSenderoAppLlms,
  buildSenderoDocsLlms,
  buildSenderoEdgeLlms,
  buildSenderoHelpLlms,
  buildSenderoMarketingLlms,
  buildLlmsResponse,
  joinUrl,
  normalizeOrigin,
  type LlmsItem,
} from './index';

describe('@sendero/llms', () => {
  test('renders canonical markdown for every web surface', () => {
    for (const config of [
      buildSenderoAppLlms(),
      buildSenderoMarketingLlms(),
      buildSenderoHelpLlms(),
      buildSenderoDocsLlms(),
      buildSenderoEdgeLlms(),
    ]) {
      const text = buildLlmsTxt(config);
      expect(text.startsWith(`# ${config.title}`)).toBe(true);
      expect(text).toContain(`Canonical: ${config.canonicalUrl}`);
      expect(text).toContain('## Product');
      expect(text).toContain('## Agent Guidance');
      expect(text).not.toContain('](/');
      expect(text).not.toContain('undefined');
    }
  });

  test('renders edge tool-discovery context without leaking private endpoints', () => {
    const config = buildSenderoEdgeLlms({
      edgeOrigin: 'https://sendero-dev-bufi.ngrok.app',
      appOrigin: 'https://www.sendero.travel',
      docsOrigin: 'https://docs.sendero.travel',
    });
    const text = buildLlmsTxt(config);

    expect(text).toContain('Canonical: https://sendero-dev-bufi.ngrok.app/llms.txt');
    expect(text).toContain('/mcp');
    expect(text).toContain('/tools');
    expect(text).toContain('search_flights');
    expect(text).toContain('settle_split');
    expect(text).not.toContain('TREASURY_PRIVATE_KEY');
    expect(text).not.toContain('CLERK_SECRET_KEY');
    expect(text).not.toContain('undefined');
  });

  test('normalizes route URLs for local and production origins', () => {
    expect(normalizeOrigin('https://sendero.travel///')).toBe('https://sendero.travel');
    expect(joinUrl('https://sendero.travel/', 'llms.txt')).toBe('https://sendero.travel/llms.txt');
    expect(joinUrl('https://sendero.travel', '/docs')).toBe('https://sendero.travel/docs');
    expect(absoluteUrl('https://sendero.travel', 'https://docs.sendero.travel')).toBe(
      'https://docs.sendero.travel'
    );
  });

  test('returns cacheable plain-text responses for Next route handlers', async () => {
    const response = buildLlmsResponse(buildSenderoHelpLlms());

    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('cache-control')).toContain('s-maxage=3600');
    await expect(response.text()).resolves.toContain('# Sendero Help');
  });

  test('supports local origins without changing route content structure', () => {
    const text = buildLlmsTxt(
      buildSenderoMarketingLlms({
        marketingOrigin: 'http://localhost:3011',
        appOrigin: 'http://localhost:3010',
        helpOrigin: 'http://localhost:3012',
        docsOrigin: 'http://localhost:3020',
      })
    );

    expect(text).toContain('Canonical: http://localhost:3011/llms.txt');
    expect(text).toContain('[App](http://localhost:3010)');
    expect(text).toContain('[Help](http://localhost:3012)');
    expect(text).toContain('[Docs](http://localhost:3020)');
  });

  // ── LlmsItem structured-metadata rendering ─────────────────────────
  //
  // Locks the trailing-parenthetical format so future schema changes
  // don't silently regress the agent surface. Three properties:
  //   1. items without metadata render exactly as before (back-compat).
  //   2. requiredScopes / optionalScopes / pricingMicroUsdc all surface
  //      when present.
  //   3. pricing is formatted as $<dollars> with 4-decimal precision
  //      (so $0.003 reads as '$0.0030', not as scientific notation).
  describe('LlmsItem metadata rendering', () => {
    function renderOne(item: LlmsItem): string {
      const config = {
        title: 'Test',
        summary: 'Test summary',
        canonicalUrl: 'https://example.com',
        sections: [{ heading: 'Tools', items: [item] }],
      };
      return buildLlmsTxt(config);
    }

    test('item without metadata renders unchanged (back-compat)', () => {
      const text = renderOne({ label: 'plain_tool', description: 'Plain.' });
      expect(text).toContain('- plain_tool - Plain.');
      // No trailing parenthetical
      expect(text).not.toContain('plain_tool - Plain. (');
    });

    test('requiredScopes renders as scopes: list', () => {
      const text = renderOne({
        label: 'gated_tool',
        description: 'Gated.',
        requiredScopes: ['settlement', 'treasury'],
      });
      expect(text).toContain('- gated_tool - Gated. (scopes: settlement, treasury)');
    });

    test('optionalScopes renders with +optional: prefix', () => {
      const text = renderOne({
        label: 'override_capable',
        description: 'Override.',
        requiredScopes: ['settlement'],
        optionalScopes: ['tenant:pricing:override'],
      });
      expect(text).toContain(
        '- override_capable - Override. (scopes: settlement; +optional: tenant:pricing:override)'
      );
    });

    test('pricingMicroUsdc renders as $<dollars> with 4-decimal precision', () => {
      const text = renderOne({
        label: 'priced_tool',
        description: 'Priced.',
        pricingMicroUsdc: 3_000, // $0.003 — must render as $0.0030, not 3e-3
      });
      expect(text).toContain('- priced_tool - Priced. ($0.0030)');
    });

    test('full metadata renders all three parts in order', () => {
      const text = renderOne({
        label: 'confirm_booking',
        description: 'Snapshot + commit.',
        requiredScopes: ['settlement'],
        optionalScopes: ['tenant:pricing:override'],
        pricingMicroUsdc: 3_000,
      });
      expect(text).toContain(
        '- confirm_booking - Snapshot + commit. (scopes: settlement; +optional: tenant:pricing:override; $0.0030)'
      );
    });

    test('zero pricing still renders ($0.0000) — distinct from absent', () => {
      const text = renderOne({
        label: 'free_tool',
        description: 'Free.',
        pricingMicroUsdc: 0,
      });
      expect(text).toContain('- free_tool - Free. ($0.0000)');
    });
  });
});
