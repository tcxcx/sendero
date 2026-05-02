import { isMetaMockPhoneNumber } from './whatsapp-mock-number';
import { describe, expect, test } from 'bun:test';

describe('isMetaMockPhoneNumber', () => {
  test('detects Meta placeholder +1 555 numbers', () => {
    expect(isMetaMockPhoneNumber('+1 555-932-5668')).toBe(true);
    expect(isMetaMockPhoneNumber('+15559325668')).toBe(true);
  });

  test('allows real-looking tenant numbers', () => {
    expect(isMetaMockPhoneNumber('+1 201-471-6388')).toBe(false);
    expect(isMetaMockPhoneNumber('+54 11 5555 0000')).toBe(false);
    expect(isMetaMockPhoneNumber(null)).toBe(false);
  });
});
