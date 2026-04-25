import { describe, expect, test } from 'bun:test';

import {
  SENDERO_TEMPLATES,
  buildOtpComponents,
  buildSecurityAlertComponents,
  encodeApprovalButtonId,
  isOutsideSessionWindowError,
  parseApprovalButtonId,
  resolveTemplateLocale,
} from './templates';

describe('SENDERO_TEMPLATES registry', () => {
  test('OTP_RESEND is AUTHENTICATION-category with single body var', () => {
    const t = SENDERO_TEMPLATES.OTP_RESEND;
    expect(t.name).toBe('sendero_otp');
    expect(t.category).toBe('AUTHENTICATION');
    expect(t.bodyVars).toEqual(['code']);
  });

  test('SECURITY_ALERT carries header + body vars', () => {
    const t = SENDERO_TEMPLATES.SECURITY_ALERT;
    expect(t.name).toBe('sendero_security_alert');
    expect(t.category).toBe('UTILITY');
    expect(t.headerVars).toEqual(['subject']);
    expect(t.bodyVars).toEqual(['body']);
  });
});

describe('buildOtpComponents', () => {
  test('mirrors the code into both body and button parameters', () => {
    const components = buildOtpComponents('482915');
    expect(components).toHaveLength(2);
    expect(components[0]).toEqual({
      type: 'body',
      parameters: [{ type: 'text', text: '482915' }],
    });
    // Meta requires the code on the button so COPY_CODE actually copies
    // the right value — drop this and you get a "code mismatch" UX bug.
    expect(components[1]).toEqual({
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [{ type: 'text', text: '482915' }],
    });
  });
});

describe('buildSecurityAlertComponents', () => {
  test('places subject in header, body in body', () => {
    const components = buildSecurityAlertComponents(
      'Trip lockout triggered',
      'Trip 0xabc... has been locked after 3 failed claim attempts.'
    );
    expect(components).toEqual([
      {
        type: 'header',
        parameters: [{ type: 'text', text: 'Trip lockout triggered' }],
      },
      {
        type: 'body',
        parameters: [
          {
            type: 'text',
            text: 'Trip 0xabc... has been locked after 3 failed claim attempts.',
          },
        ],
      },
    ]);
  });
});

describe('isOutsideSessionWindowError', () => {
  test('detects (#131047) re-engagement error', () => {
    const err = new Error(
      'WhatsApp request failed: 400 Bad Request - Message failed to send because more than 24 hours have passed since the customer last replied to this number. (#131047)'
    );
    expect(isOutsideSessionWindowError(err)).toBe(true);
  });

  test('detects (#131026) message-undeliverable error', () => {
    const err = new Error('(#131026) Message Undeliverable');
    expect(isOutsideSessionWindowError(err)).toBe(true);
  });

  test('returns false for unrelated errors so we do not template-spam', () => {
    expect(isOutsideSessionWindowError(new Error('(#131000) Generic API error'))).toBe(false);
    expect(isOutsideSessionWindowError(new Error('rate limited'))).toBe(false);
    expect(isOutsideSessionWindowError(new Error('auth invalid'))).toBe(false);
  });

  test('handles non-Error throws (string, undefined)', () => {
    expect(isOutsideSessionWindowError('plain string')).toBe(false);
    expect(isOutsideSessionWindowError(undefined)).toBe(false);
    expect(isOutsideSessionWindowError(null)).toBe(false);
  });
});

describe('resolveTemplateLocale', () => {
  test('returns default when no requested locale', () => {
    expect(resolveTemplateLocale(SENDERO_TEMPLATES.OTP_RESEND, undefined)).toBe('en_US');
  });

  test('matches BCP-47 → Meta format (es-AR → es_MX via base-language fallback)', () => {
    expect(resolveTemplateLocale(SENDERO_TEMPLATES.OTP_RESEND, 'es-AR')).toBe('es_MX');
  });

  test('exact match in fallbackLocales wins over base-language fallback', () => {
    expect(resolveTemplateLocale(SENDERO_TEMPLATES.OTP_RESEND, 'pt-BR')).toBe('pt_BR');
  });
});

describe('approval-button id round-trip', () => {
  test('encode + parse preserves action and subject id', () => {
    const id = encodeApprovalButtonId('approve', 'trip_abc123');
    expect(id).toBe('sendero.approve.trip_abc123');
    expect(parseApprovalButtonId(id)).toEqual({
      action: 'approve',
      subjectId: 'trip_abc123',
    });
  });

  test('parse returns null on malformed input', () => {
    expect(parseApprovalButtonId('garbage')).toBeNull();
    expect(parseApprovalButtonId('sendero.unknown.x')).toBeNull();
  });
});
