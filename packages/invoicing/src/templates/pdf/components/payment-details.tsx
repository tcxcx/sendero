import { StyleSheet, Text, View } from '@react-pdf/renderer';
import type { TemplateProps } from '../../types';
import { resolvePdfColors, theme } from '../theme';

const styles = StyleSheet.create({
  container: {
    marginTop: theme.spacing(4),
    paddingTop: theme.spacing(3),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  label: {
    fontFamily: theme.fonts.mono,
    fontSize: theme.sizes.label,
    color: theme.colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: theme.spacing(1.5),
  },
  body: {
    fontFamily: theme.fonts.sans,
    fontSize: theme.sizes.small,
    color: theme.colors.text,
    lineHeight: 1.5,
  },
});

export function PaymentDetails({ template }: TemplateProps) {
  const instructions = (template as { payment_instructions?: string }).payment_instructions?.trim();
  if (!instructions) return null;
  const colors = resolvePdfColors(template.brand_colors);

  return (
    <View style={[styles.container, { borderTopColor: colors.primary }]}>
      <Text style={[styles.label, { color: colors.accent }]}>{template.payment_label}</Text>
      <Text style={styles.body}>{instructions}</Text>
    </View>
  );
}
