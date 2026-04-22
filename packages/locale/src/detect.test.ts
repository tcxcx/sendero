import { describe, expect, test } from 'bun:test';
import { detectLocale, localeForPhone, normalizeLocale, LOCALE_COOKIE_NAME } from './index';

describe('@sendero/locale detection', () => {
  test('prefers explicit cookie and sanitizes unsupported values', () => {
    expect(LOCALE_COOKIE_NAME).toBe('SENDERO_LOCALE');
    expect(detectLocale({ cookie: 'es-AR', acceptLanguage: 'pt-BR, en;q=0.8' })).toBe('es-AR');
    expect(detectLocale({ cookie: 'xx-YY', acceptLanguage: 'pt-BR, en;q=0.8' })).toBe('pt-BR');
  });

  test('normalizes browser language and geo country hints', () => {
    expect(normalizeLocale('pt')).toBe('pt-BR');
    expect(detectLocale({ acceptLanguage: 'es-AR,es;q=0.8,en;q=0.4' })).toBe('es-AR');
    expect(detectLocale({ country: 'BR' })).toBe('pt-BR');
  });

  test('infers common WhatsApp phone prefixes for channel adapters', () => {
    expect(localeForPhone('+54 9 11 1234-5678')).toBe('es-AR');
    expect(localeForPhone('+55 11 90000-0000')).toBe('pt-BR');
    expect(localeForPhone('+52 55 1234 5678')).toBe('es-MX');
    expect(localeForPhone('+1 415 555 0100')).toBe('en-US');
  });
});
