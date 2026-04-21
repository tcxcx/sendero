import { StyleSheet, Text, View } from '@react-pdf/renderer';
import type { TemplateProps } from '../../types';
import { theme } from '../theme';

const styles = StyleSheet.create({
  container: { flexDirection: 'column' },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingVertical: theme.spacing(1.5),
  },
  row: {
    flexDirection: 'row',
    paddingVertical: theme.spacing(1.5),
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border,
  },
  headerCell: {
    fontFamily: theme.fonts.mono,
    fontSize: theme.sizes.label,
    color: theme.colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  cellDescription: { flex: 4, paddingRight: theme.spacing(2) },
  cellQuantity: { flex: 1, textAlign: 'right' },
  cellUnitPrice: { flex: 1.5, textAlign: 'right', fontFamily: theme.fonts.mono },
  cellAmount: { flex: 1.5, textAlign: 'right', fontFamily: theme.fonts.mono },
  body: {
    fontFamily: theme.fonts.sans,
    fontSize: theme.sizes.base,
    color: theme.colors.text,
  },
});

function formatCurrency(value: string, currency: string, locale: string): string {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return value;
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(asNumber);
}

export function LineItems({ invoice, template }: TemplateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={[styles.headerCell, styles.cellDescription]}>{template.description_label}</Text>
        <Text style={[styles.headerCell, styles.cellQuantity]}>{template.quantity_label}</Text>
        <Text style={[styles.headerCell, styles.cellUnitPrice]}>{template.price_label}</Text>
        <Text style={[styles.headerCell, styles.cellAmount]}>{template.total_label}</Text>
      </View>
      {invoice.lineItems.map(li => (
        <View style={styles.row} key={li.position}>
          <Text style={[styles.body, styles.cellDescription]}>{li.description}</Text>
          <Text style={[styles.body, styles.cellQuantity]}>{li.quantity}</Text>
          <Text style={[styles.body, styles.cellUnitPrice]}>
            {formatCurrency(li.unitPrice, invoice.currency, template.locale)}
          </Text>
          <Text style={[styles.body, styles.cellAmount]}>
            {formatCurrency(li.amount, invoice.currency, template.locale)}
          </Text>
        </View>
      ))}
    </View>
  );
}
