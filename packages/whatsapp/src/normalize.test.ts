import { formatForWhatsApp, toWhatsAppMarkdown } from './normalize';
import { describe, expect, test } from 'bun:test';

describe('formatForWhatsApp', () => {
  test('converts agent markdown into WhatsApp-native text', () => {
    const out = toWhatsAppMarkdown(
      '# Wallet\nTienes **$314.87 USDC** en tu wallet.\n- Arc Testnet: `$274.35`\n[Recargar](https://pay.example.com)'
    );

    expect(out).toContain('*Wallet*');
    expect(out).toContain('*$314.87 USDC*');
    expect(out).toContain('- Arc Testnet: $274.35');
    expect(out).toContain('Recargar (https://pay.example.com)');
    expect(out).not.toContain('**');
    expect(out).not.toContain('`');
  });

  test('chunks after formatting', () => {
    const chunks = formatForWhatsApp('**uno**\n'.repeat(5), { maxChars: 12 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('\n')).not.toContain('**');
  });
});
