export function isMetaMockPhoneNumber(value: string | null | undefined): boolean {
  if (!value) return false;
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1555');
}

export const META_MOCK_PHONE_NUMBER_MESSAGE =
  'Meta returned a +1 555 mock number. Disconnect and run WhatsApp setup again with a real WhatsApp Business number.';
