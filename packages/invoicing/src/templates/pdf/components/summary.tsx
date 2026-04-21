import { StyleSheet, Text, View } from '@react-pdf/renderer';
import type { TemplateProps } from '../../types';
import { resolvePdfColors, theme } from '../theme';

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  panel: { width: '45%', gap: theme.spacing(1) },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing(0.5),
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: theme.spacing(2),
    marginTop: theme.spacing(2),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  label: {
    fontFamily: theme.fonts.sans,
    fontSize: theme.sizes.base,
    color: theme.colors.muted,
  },
  value: {
    fontFamily: theme.fonts.mono,
    fontSize: theme.sizes.base,
    color: theme.colors.text,
  },
  totalLabel: {
    fontFamily: theme.fonts.sansSemibold,
    fontSize: theme.sizes.base,
    color: theme.colors.text,
  },
  totalValue: {
    fontFamily: theme.fonts.monoBold,
    fontSize: theme.sizes.base,
    color: theme.colors.text,
  },
});

function money(value: string, currency: string, locale: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
}

export function Summary({ invoice, template }: TemplateProps) {
  const colors = resolvePdfColors(template.brand_colors);
  const showDiscount = template.include_discount && Number(invoice.discount) > 0;
  const showTax = template.include_tax && Number(invoice.taxAmount) > 0;
  const showVat = template.include_vat && Number(invoice.vatAmount) > 0;

  return (
    <View style={styles.container}>
      <View style={styles.panel}>
        <View style={styles.row}>
          <Text style={styles.label}>{template.subtotal_label}</Text>
          <Text style={styles.value}>
            {money(invoice.subtotal, invoice.currency, template.locale)}
          </Text>
        </View>
        {showDiscount ? (
          <View style={styles.row}>
            <Text style={styles.label}>{template.discount_label}</Text>
            <Text style={styles.value}>
              -{money(invoice.discount, invoice.currency, template.locale)}
            </Text>
          </View>
        ) : null}
        {showTax ? (
          <View style={styles.row}>
            <Text style={styles.label}>{template.tax_label}</Text>
            <Text style={styles.value}>
              {money(invoice.taxAmount, invoice.currency, template.locale)}
            </Text>
          </View>
        ) : null}
        {showVat ? (
          <View style={styles.row}>
            <Text style={styles.label}>{template.vat_label}</Text>
            <Text style={styles.value}>
              {money(invoice.vatAmount, invoice.currency, template.locale)}
            </Text>
          </View>
        ) : null}
        <View style={[styles.totalRow, { borderTopColor: colors.primary }]}>
          <Text style={styles.totalLabel}>{template.total_summary_label}</Text>
          <Text style={[styles.totalValue, { color: colors.primary }]}>
            {money(invoice.total, invoice.currency, template.locale)}
          </Text>
        </View>
      </View>
    </View>
  );
}
