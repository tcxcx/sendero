// packages/invoicing/src/templates/pdf/theme.ts
export const theme = {
  colors: {
    primary: '#fb542b',
    text: '#0b0b0b',
    muted: '#555555',
    border: '#e9e3da',
    subtle: '#f5f2ee',
    accent: '#b34b2e',
  },
  sizes: {
    base: 10,
    small: 9,
    label: 8,
    heading: 16,
    huge: 24,
  },
  fonts: {
    sans: 'Inter',
    sansBold: 'Inter-Bold',
    sansMedium: 'Inter-Medium',
    sansSemibold: 'Inter-SemiBold',
    mono: 'JetBrainsMono',
    monoBold: 'JetBrainsMono-Bold',
  },
  spacing: (n: number) => n * 4,
};

export type PdfBrandColors = {
  primary?: string;
  accent?: string;
  background?: string;
};

function safeHex(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined;
}

export function resolvePdfColors(colors?: PdfBrandColors | null) {
  const primary = safeHex(colors?.primary) ?? theme.colors.primary;
  const accent = safeHex(colors?.accent) ?? theme.colors.accent;
  const background = safeHex(colors?.background) ?? '#ffffff';

  return {
    ...theme.colors,
    primary,
    accent,
    background,
  };
}
