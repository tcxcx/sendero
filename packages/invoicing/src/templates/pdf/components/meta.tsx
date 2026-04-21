import { Image, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { TemplateProps } from '../../types';
import { theme } from '../theme';

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing(6),
  },
  block: { flex: 1, gap: theme.spacing(1) },
  logoRow: { marginBottom: theme.spacing(2) },
  logo: { width: 56, height: 56 },
  label: {
    fontFamily: theme.fonts.mono,
    fontSize: theme.sizes.label,
    color: theme.colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  value: {
    fontFamily: theme.fonts.sans,
    fontSize: theme.sizes.base,
  },
  valueBold: {
    fontFamily: theme.fonts.sansSemibold,
    fontSize: theme.sizes.base,
  },
  title: {
    fontFamily: theme.fonts.sansBold,
    fontSize: theme.sizes.huge,
    color: theme.colors.text,
    marginBottom: theme.spacing(2),
  },
  number: {
    fontFamily: theme.fonts.mono,
    fontSize: theme.sizes.base,
    color: theme.colors.text,
  },
});

export function Meta({ invoice, template }: TemplateProps) {
  const issuedFmt = new Intl.DateTimeFormat(template.locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(invoice.issuedAt);
  const dueFmt = invoice.dueAt
    ? new Intl.DateTimeFormat(template.locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(invoice.dueAt)
    : null;

  return (
    <View style={styles.container}>
      <View style={styles.block}>
        {invoice.from.logoUrl ? (
          <View style={styles.logoRow}>
            <Image src={invoice.from.logoUrl} style={styles.logo} />
          </View>
        ) : null}
        <Text style={styles.label}>{template.from_label}</Text>
        <Text style={styles.valueBold}>{invoice.from.name}</Text>
        {invoice.from.taxId ? <Text style={styles.value}>{invoice.from.taxId}</Text> : null}
      </View>

      <View style={styles.block}>
        <Text style={styles.title}>{template.title}</Text>
        <Text style={styles.label}>{template.invoice_no_label}</Text>
        <Text style={styles.number}>{invoice.number}</Text>
        <Text style={styles.label}>{template.issue_date_label}</Text>
        <Text style={styles.value}>{issuedFmt}</Text>
        {dueFmt ? (
          <>
            <Text style={styles.label}>{template.due_date_label}</Text>
            <Text style={styles.value}>{dueFmt}</Text>
          </>
        ) : null}
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>{template.customer_label}</Text>
        <Text style={styles.valueBold}>{invoice.to.name}</Text>
        <Text style={styles.value}>{invoice.to.email}</Text>
        {invoice.to.taxId ? <Text style={styles.value}>{invoice.to.taxId}</Text> : null}
      </View>
    </View>
  );
}
