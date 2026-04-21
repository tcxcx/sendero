import { describe, expect, test } from 'bun:test';
import {
  buildLlmsTxt,
  buildSenderoAppLlms,
  buildSenderoDocsLlms,
  buildSenderoHelpLlms,
  buildSenderoMarketingLlms,
} from './index';

describe('@sendero/llms', () => {
  test('renders canonical markdown for every web surface', () => {
    for (const config of [
      buildSenderoAppLlms(),
      buildSenderoMarketingLlms(),
      buildSenderoHelpLlms(),
      buildSenderoDocsLlms(),
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
