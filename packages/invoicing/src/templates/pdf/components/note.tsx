import { StyleSheet, Text, View } from '@react-pdf/renderer';
import type { TemplateProps } from '../../types';
import { resolvePdfColors, theme } from '../theme';

const styles = StyleSheet.create({
  container: {
    marginTop: theme.spacing(6),
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

export function Note({ template }: TemplateProps) {
  const body = (template as { note_body?: string }).note_body?.trim();
  if (!body) return null;
  const colors = resolvePdfColors(template.brand_colors);

  return (
    <View style={[styles.container, { borderTopColor: colors.primary }]}>
      <Text style={[styles.label, { color: colors.accent }]}>{template.note_label}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}
