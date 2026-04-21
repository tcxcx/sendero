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
      appOrigin: 'https://app.sendero.travel',
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
});
